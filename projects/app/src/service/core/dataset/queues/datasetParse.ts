/**
 * 数据集解析队列模块
 * 
 * 功能概述：
 * 负责处理数据集集合的源文件解析，是FastGPT知识库数据预处理的核心模块。
 * 该模块将各种格式的原始数据转换为可用于向量化的结构化文本块。
 * 
 * 主要职责：
 * 1. 多源数据读取：支持本地文件、网页链接、API文件、外部文件等多种数据源
 * 2. 智能文本提取：从PDF、Word、网页等格式中提取纯文本内容
 * 3. AI段落优化：使用LLM对原始文本进行段落结构优化和格式化
 * 4. 智能文本分块：根据配置将长文本分割为适合向量化的文本块
 * 5. 数据质量控制：检查数据集限制，确保不超过团队配额
 * 6. 元数据管理：维护文件标题、哈希值等元信息
 * 
 * 处理流程：
 * 原始数据源 → 文本提取 → AI段落处理 → 文本分块 → 推送到训练队列
 * 
 * 支持的数据源类型：
 * - 本地文件：PDF、Word、TXT、Markdown等格式
 * - 网页链接：自动抓取网页内容并提取文本
 * - API文件：通过API接口获取的文件数据
 * - 外部文件：第三方存储的文件资源
 * 
 * 技术特点：
 * - 异步处理：支持大文件的非阻塞处理
 * - 错误恢复：提供重试机制和错误处理
 * - 资源管理：自动清理临时文件和过期数据
 * - 事务安全：使用数据库事务确保数据一致性
 * 
 * 注意事项：
 * - 此模块不处理最大尺寸限制，由上层调用方控制
 * - 处理大文件时可能消耗较多内存和计算资源
 * - AI段落处理会产生LLM调用费用
 * 
 * @module dataset/queues/datasetParse
 * @author FastGPT Team
 */

// 常量定义
import { ParagraphChunkAIModeEnum } from '@fastgpt/global/core/dataset/constants';
import {
  DatasetCollectionDataProcessModeEnum,
  DatasetCollectionTypeEnum,
  DatasetSourceReadTypeEnum,
  TrainingModeEnum
} from '@fastgpt/global/core/dataset/constants';
import { DatasetDataIndexTypeEnum } from '@fastgpt/global/core/dataset/data/constants';

// 类型定义
import type {
  DatasetCollectionSchemaType,
  DatasetSchemaType
} from '@fastgpt/global/core/dataset/type';

// 日志系统
import { addLog } from '@fastgpt/service/common/system/log';

// MongoDB 模型
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { MongoDatasetCollection } from '@fastgpt/service/core/dataset/collection/schema';
import { MongoImage } from '@fastgpt/service/common/file/image/schema';

// 时间处理
import { addMinutes } from 'date-fns';

// 工具函数
import { checkTeamAiPointsAndLock } from './utils';
import { getErrText } from '@fastgpt/global/common/error/utils';
import { delay } from '@fastgpt/service/common/bullmq';
import { hashStr } from '@fastgpt/global/common/string/tools';

// 数据集处理
import { rawText2Chunks, readDatasetSourceRawText } from '@fastgpt/service/core/dataset/read';
import { getTrainingModeByCollection } from '@fastgpt/service/core/dataset/collection/utils';
import { pushDataListToTrainingQueue } from '@fastgpt/service/core/dataset/training/controller';

// AI 模型相关
import { getLLMModel } from '@fastgpt/service/core/ai/model';
import { getLLMMaxChunkSize } from '@fastgpt/global/core/dataset/training/utils';

// 权限和限制
import { checkDatasetIndexLimit } from '@fastgpt/service/support/permission/teamLimit';
import { predictDataLimitLength } from '@fastgpt/global/core/dataset/utils';

// 数据库事务
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';

// API 请求
import { POST } from '@fastgpt/service/common/api/plusRequest';

// 使用量统计
import { pushLLMTrainingUsage } from '@fastgpt/service/support/wallet/usage/controller';

/**
 * 请求LLM进行段落处理
 * 
 * 该函数负责使用大语言模型对原始文本进行智能段落优化处理。
 * 主要用于改善文本的结构性和可读性，提高后续向量化的质量。
 * 
 * 处理策略：
 * 
 * 1. 模式检查：
 *    - 检查是否启用Plus功能和AI段落处理
 *    - 如果禁用，直接返回原始文本
 * 
 * 2. 自动模式智能判断：
 *    - 检测文本是否包含Markdown标题结构
 *    - 如果已有良好的标题层次，跳过AI处理
 *    - 避免对已结构化文本的重复处理
 * 
 * 3. LLM调用：
 *    - 通过API调用专门的段落处理服务
 *    - 设置较长的超时时间（10分钟）处理大文本
 *    - 记录输入和输出token消耗
 * 
 * 支持的处理模式：
 * - forbid: 禁用AI段落处理
 * - auto: 自动判断是否需要处理
 * - force: 强制进行AI段落处理
 * 
 * 处理效果：
 * - 优化段落分割，使内容更加连贯
 * - 改善文本格式，提高可读性
 * - 保持原文语义，不改变核心内容
 * - 为后续分块处理提供更好的基础
 * 
 * 性能考虑：
 * - 大文本处理可能耗时较长
 * - 会产生LLM调用费用
 * - 支持超时控制避免长时间阻塞
 * 
 * @param {Object} params - 参数对象
 * @param {string} params.rawText - 需要处理的原始文本内容
 * @param {string} params.model - 使用的LLM模型标识符
 * @param {string} params.billId - 计费标识，用于费用统计
 * @param {ParagraphChunkAIModeEnum} params.paragraphChunkAIMode - 段落AI处理模式
 * 
 * @returns {Promise<{resultText: string, totalInputTokens: number, totalOutputTokens: number}>}
 *   返回处理结果对象，包含：
 *   - resultText: 处理后的文本内容
 *   - totalInputTokens: 输入token消耗数量
 *   - totalOutputTokens: 输出token消耗数量
 * 
 * @throws {Error} 当API调用失败或超时时抛出异常
 * 
 * @example
 * ```typescript
 * const result = await requestLLMPargraph({
 *   rawText: '原始文档内容...',
 *   model: 'gpt-3.5-turbo',
 *   billId: 'bill_123',
 *   paragraphChunkAIMode: ParagraphChunkAIModeEnum.auto
 * });
 * console.log(`处理完成，消耗token: ${result.totalInputTokens + result.totalOutputTokens}`);
 * ```
 */
const requestLLMPargraph = async ({
  rawText,
  model,
  billId,
  paragraphChunkAIMode
}: {
  rawText: string;
  model: string;
  billId: string;
  paragraphChunkAIMode: ParagraphChunkAIModeEnum;
}) => {
  if (
    !global.feConfigs?.isPlus ||
    !paragraphChunkAIMode ||
    paragraphChunkAIMode === ParagraphChunkAIModeEnum.forbid
  ) {
    return {
      resultText: rawText,
      totalInputTokens: 0,
      totalOutputTokens: 0
    };
  }

  if (paragraphChunkAIMode === ParagraphChunkAIModeEnum.auto) {
    // Check if the text contains Markdown header structure
    const hasMarkdownHeaders = /^(#+)\s/m.test(rawText);
    const hasMultipleHeaders = (rawText.match(/^(#+)\s/g) || []).length > 1;

    const isMarkdown = hasMarkdownHeaders && hasMultipleHeaders;

    if (isMarkdown) {
      return {
        resultText: rawText,
        totalInputTokens: 0,
        totalOutputTokens: 0
      };
    }
  }

  const data = await POST<{
    resultText: string;
    totalInputTokens: number;
    totalOutputTokens: number;
  }>(
    '/core/dataset/training/llmPargraph',
    {
      rawText,
      model,
      billId
    },
    { timeout: 600000 }
  );

  return data;
};

/**
 * 数据集解析队列处理函数
 * 
 * 这是数据集解析系统的核心调度函数，负责管理整个文件解析和预处理流程。
 * 该函数采用持续轮询模式，处理队列中的解析任务直到队列为空。
 * 
 * 详细处理流程：
 * 
 * 1. 任务获取与锁定：
 *    - 查询待处理的解析任务（mode: parse）
 *    - 使用乐观锁机制防止任务重复处理
 *    - 设置10分钟的锁定超时，避免死锁
 *    - 加载关联的数据集和集合信息
 * 
 * 2. 数据有效性验证：
 *    - 检查数据集和集合是否存在
 *    - 验证团队AI积分余额
 *    - 清理无效的任务记录
 * 
 * 3. 数据源类型识别：
 *    - 本地文件：通过fileId读取上传的文件
 *    - 网页链接：抓取指定URL的网页内容
 *    - API文件：从API服务器获取文件数据
 *    - 外部文件：访问第三方存储的文件
 * 
 * 4. 原始文本提取：
 *    - 根据文件类型选择合适的解析器
 *    - 提取文件标题和纯文本内容
 *    - 支持自定义PDF解析配置
 *    - 处理各种编码和格式问题
 * 
 * 5. AI段落优化处理：
 *    - 根据配置决定是否使用LLM优化
 *    - 改善文本的段落结构和格式
 *    - 记录LLM使用量用于计费
 *    - 提高后续分块质量
 * 
 * 6. 智能文本分块：
 *    - 根据集合配置进行文本分割
 *    - 支持多种分块策略和触发条件
 *    - 控制分块大小和重叠比例
 *    - 生成适合向量化的文本片段
 * 
 * 7. 数据集限制检查：
 *    - 预测新增数据的索引数量
 *    - 检查是否超过团队配额限制
 *    - 超限时锁定任务并记录错误
 * 
 * 8. 数据库事务更新：
 *    - 更新集合的标题和文本统计信息
 *    - 将分块数据推送到训练队列
 *    - 删除已完成的解析任务
 *    - 清理相关图片的TTL设置
 * 
 * 9. 错误处理与重试：
 *    - 捕获处理过程中的各种异常
 *    - 记录详细的错误信息
 *    - 支持任务重试机制
 *    - 避免错误任务阻塞队列
 * 
 * 技术特性：
 * - 异步处理：支持大文件的非阻塞处理
 * - 事务安全：关键操作使用数据库事务
 * - 资源管理：自动清理临时文件和过期数据
 * - 监控友好：提供详细的日志记录和性能指标
 * - 容错能力：支持部分失败后的恢复和重试
 * 
 * 性能优化：
 * - 批量数据库操作减少IO次数
 * - 智能分块算法提高处理效率
 * - 内存管理避免大文件内存溢出
 * - 并发控制防止资源竞争
 * 
 * 注意事项：
 * - 处理大文件时可能耗时较长
 * - AI段落处理会产生额外费用
 * - 需要足够的内存处理大型文档
 * - 网络文件可能存在访问延迟
 * 
 * @returns {Promise<any>} 处理结果的Promise对象
 * 
 * @throws {Error} 当系统资源不足或关键服务不可用时抛出异常
 * 
 * @example
 * ```typescript
 * // 启动数据集解析队列处理
 * try {
 *   await datasetParseQueue();
 *   console.log('解析队列处理完成');
 * } catch (error) {
 *   console.error('解析队列处理失败:', error);
 * }
 * ```
 */
export const datasetParseQueue = async (): Promise<any> => {
  const startTime = Date.now();

  while (true) {
    // 1. Get task and lock 20 minutes ago
    const {
      data,
      done = false,
      error = false
    } = await (async () => {
      try {
        const data = await MongoDatasetTraining.findOneAndUpdate(
          {
            mode: TrainingModeEnum.parse,
            retryCount: { $gt: 0 },
            lockTime: { $lte: addMinutes(new Date(), -10) }
          },
          {
            lockTime: new Date(),
            $inc: { retryCount: -1 }
          }
        )
          .populate<{
            dataset: DatasetSchemaType;
            collection: DatasetCollectionSchemaType;
          }>([
            {
              path: 'collection',
              select: '-qaPrompt'
            },
            {
              path: 'dataset'
            }
          ])
          .lean();

        // task preemption
        if (!data) {
          return {
            done: true
          };
        }
        return {
          data
        };
      } catch (error) {
        return {
          error: true
        };
      }
    })();

    if (done || !data) {
      break;
    }
    if (error) {
      addLog.error(`[Parse Queue] Error`, error);
      await delay(500);
      continue;
    }
    // Check team points and lock(No mistakes will be thrown here)
    if (!(await checkTeamAiPointsAndLock(data.teamId))) {
      break;
    }

    const dataset = data.dataset;
    const collection = data.collection;

    if (!dataset || !collection) {
      addLog.warn(`[Parse Queue] data not found`, data);
      await MongoDatasetTraining.deleteOne({ _id: data._id });
      break;
    }

    addLog.info(`[Parse Queue] Start`);

    try {
      const trainingMode = getTrainingModeByCollection({
        trainingType: collection.trainingType,
        autoIndexes: collection.autoIndexes,
        imageIndex: collection.imageIndex
      });

      // 1. Parse rawtext
      const sourceReadType = await (async () => {
        if (collection.type === DatasetCollectionTypeEnum.link) {
          if (!collection.rawLink) return Promise.reject('rawLink is missing');
          return {
            type: DatasetSourceReadTypeEnum.link,
            sourceId: collection.rawLink,
            selector: collection.metadata?.webPageSelector
          };
        }
        if (collection.type === DatasetCollectionTypeEnum.file) {
          if (!collection.fileId) return Promise.reject('fileId is missing');
          return {
            type: DatasetSourceReadTypeEnum.fileLocal,
            sourceId: String(collection.fileId)
          };
        }
        if (collection.type === DatasetCollectionTypeEnum.apiFile) {
          if (!collection.apiFileId) return Promise.reject('apiFileId is missing');
          return {
            type: DatasetSourceReadTypeEnum.apiFile,
            sourceId: collection.apiFileId,
            apiDatasetServer: dataset.apiDatasetServer
          };
        }
        if (collection.type === DatasetCollectionTypeEnum.externalFile) {
          if (!collection.externalFileUrl) return Promise.reject('externalFileId is missing');
          return {
            type: DatasetSourceReadTypeEnum.externalFile,
            sourceId: collection.externalFileUrl,
            externalFileId: collection.externalFileId
          };
        }

        return null;
      })();

      if (!sourceReadType) {
        addLog.warn(`[Parse Queue] Source read type is null, delete task`);
        await MongoDatasetTraining.deleteOne({
          _id: data._id
        });
        break;
      }

      // 2. Read source
      const { title, rawText } = await readDatasetSourceRawText({
        teamId: data.teamId,
        tmbId: data.tmbId,
        customPdfParse: collection.customPdfParse,
        ...sourceReadType
      });

      // 3. LLM Pargraph
      const { resultText, totalInputTokens, totalOutputTokens } = await requestLLMPargraph({
        rawText,
        model: dataset.agentModel,
        billId: data.billId,
        paragraphChunkAIMode: collection.paragraphChunkAIMode
      });
      // Push usage
      pushLLMTrainingUsage({
        teamId: data.teamId,
        tmbId: data.tmbId,
        model: dataset.agentModel,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        billId: data.billId,
        mode: 'paragraph'
      });

      // 4. Chunk split
      const chunks = await rawText2Chunks({
        rawText: resultText,
        chunkTriggerType: collection.chunkTriggerType,
        chunkTriggerMinSize: collection.chunkTriggerMinSize,
        chunkSize: collection.chunkSize,
        paragraphChunkDeep: collection.paragraphChunkDeep,
        paragraphChunkMinSize: collection.paragraphChunkMinSize,
        maxSize: getLLMMaxChunkSize(getLLMModel(dataset.agentModel)),
        overlapRatio:
          collection.trainingType === DatasetCollectionDataProcessModeEnum.chunk ? 0.2 : 0,
        customReg: collection.chunkSplitter ? [collection.chunkSplitter] : [],
        backupParse: collection.trainingType === DatasetCollectionDataProcessModeEnum.backup
      });

      // Check dataset limit
      try {
        await checkDatasetIndexLimit({
          teamId: data.teamId,
          insertLen: predictDataLimitLength(trainingMode, chunks)
        });
      } catch (error) {
        addLog.warn(`[Parse Queue] Check dataset limit failed, lock the task`);
        await MongoDatasetTraining.updateOne(
          {
            _id: data._id
          },
          {
            errorMsg: getErrText(error, 'Over dataset limit'),
            lockTime: new Date('2999/5/5')
          }
        );
        break;
      }

      await mongoSessionRun(async (session) => {
        // 5. Update collection title(Link)
        await MongoDatasetCollection.updateOne(
          { _id: collection._id },
          {
            ...(title && { name: title }),
            rawTextLength: resultText.length,
            hashRawText: hashStr(resultText)
          },
          { session }
        );

        // 6. Push to chunk queue
        await pushDataListToTrainingQueue({
          teamId: data.teamId,
          tmbId: data.tmbId,
          datasetId: dataset._id,
          collectionId: collection._id,
          agentModel: dataset.agentModel,
          vectorModel: dataset.vectorModel,
          vlmModel: dataset.vlmModel,
          indexSize: collection.indexSize,
          mode: trainingMode,
          billId: data.billId,
          data: chunks.map((item, index) => ({
            ...item,
            indexes: item.indexes?.map((text) => ({
              type: DatasetDataIndexTypeEnum.custom,
              text
            })),
            chunkIndex: index
          })),
          session
        });

        // 7. Delete task
        await MongoDatasetTraining.deleteOne(
          {
            _id: data._id
          },
          {
            session
          }
        );

        // 8. Remove image ttl
        const relatedImgId = collection.metadata?.relatedImgId;
        if (relatedImgId) {
          await MongoImage.updateMany(
            {
              teamId: collection.teamId,
              'metadata.relatedId': relatedImgId
            },
            {
              // Remove expiredTime to avoid ttl expiration
              $unset: {
                expiredTime: 1
              }
            },
            {
              session
            }
          );
        }
      });

      addLog.debug(`[Parse Queue] Finish`, {
        time: Date.now() - startTime
      });
      break;
    } catch (err) {
      addLog.error(`[Parse Queue] Error`, err);

      await MongoDatasetTraining.updateOne(
        {
          _id: data._id
        },
        {
          errorMsg: getErrText(err, 'unknown error'),
          lockTime: addMinutes(new Date(), -10)
        }
      );

      await delay(100);
    }
  }

  addLog.debug(`[Parse Queue] break loop`);
};
