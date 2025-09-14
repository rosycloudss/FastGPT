/**
 * 数据集解析队列模块
 * 负责处理数据集集合的源文件解析，包括文本提取、AI段落处理、文本分块等
 * 注意：此模块不处理最大尺寸限制
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
 * 根据配置的AI模式对原始文本进行智能段落分割和优化
 * @param rawText - 原始文本内容
 * @param model - 使用的LLM模型
 * @param billId - 计费ID
 * @param paragraphChunkAIMode - 段落AI处理模式
 * @returns 处理结果，包含处理后的文本和token消耗
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
 * 主要处理流程：
 * 1. 获取待解析任务并加锁
 * 2. 读取源文件内容
 * 3. LLM段落处理
 * 4. 文本分块
 * 5. 检查数据集限制
 * 6. 更新集合信息
 * 7. 推送到训练队列
 * 8. 清理任务和相关资源
 * @returns Promise<any>
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
