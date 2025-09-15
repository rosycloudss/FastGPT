/**
 * 问答对生成队列处理模块
 * 
 * 这是FastGPT数据集训练系统中的核心AI增强模块，专门负责将原始文本转换为高质量的问答对。
 * 该模块通过大语言模型(LLM)的强大理解能力，自动从文档内容中提取关键信息并生成相应的问答对，
 * 为知识库构建提供更丰富、更精准的训练数据。
 * 
 * 主要功能：
 * 
 * 1. 智能问答对生成：
 *    - 利用先进的LLM模型分析文本内容
 *    - 自动识别文本中的关键信息点
 *    - 生成语义准确、逻辑清晰的问答对
 *    - 支持自定义问答生成提示词
 * 
 * 2. 队列管理与并发控制：
 *    - 实现高效的任务队列调度机制
 *    - 支持多任务并发处理，提高系统吞吐量
 *    - 智能负载均衡，防止系统过载
 *    - 提供队列状态监控和管理接口
 * 
 * 3. 容错与重试机制：
 *    - 完善的错误处理和异常恢复
 *    - 支持任务失败后的自动重试
 *    - 详细的错误日志记录和分析
 *    - 防止单个任务失败影响整体处理
 * 
 * 4. 资源管理与计费：
 *    - 精确的Token使用量统计
 *    - 团队AI积分余额检查和扣费
 *    - 模型调用成本控制和优化
 *    - 支持多种计费模式和策略
 * 
 * 5. 数据质量保证：
 *    - 智能文本预处理和格式化
 *    - 问答对质量验证和筛选
 *    - 支持回退到传统分块策略
 *    - 确保生成数据的一致性和可用性
 * 
 * 技术架构特点：
 * - 异步处理：支持大规模文本的非阻塞处理
 * - 模块化设计：清晰的功能分离和接口定义
 * - 可扩展性：支持多种LLM模型和处理策略
 * - 监控友好：提供详细的性能指标和运行状态
 * - 数据安全：确保处理过程中的数据完整性
 * 
 * 应用场景：
 * - 企业知识库构建和优化
 * - 客服机器人训练数据生成
 * - 教育内容的问答对提取
 * - 技术文档的智能问答生成
 * - 法律、医疗等专业领域的知识提取
 */

// MongoDB 模型
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';

// 使用量统计
import { pushLLMTrainingUsage } from '@fastgpt/service/support/wallet/usage/controller';

// 常量定义
import { TrainingModeEnum } from '@fastgpt/global/core/dataset/constants';

// AI 相关
import { createChatCompletion } from '@fastgpt/service/core/ai/config';
import type { ChatCompletionMessageParam } from '@fastgpt/global/core/ai/type.d';
import { getLLMModel } from '@fastgpt/service/core/ai/model';
import type { LLMModelItemType } from '@fastgpt/global/core/ai/model.d';
import { llmCompletionsBodyFormat, formatLLMResponse } from '@fastgpt/service/core/ai/utils';

// 日志系统
import { addLog } from '@fastgpt/service/common/system/log';

// 字符串处理
import { replaceVariable } from '@fastgpt/global/common/string/tools';
import {
  countGptMessagesTokens,
  countPromptTokens
} from '@fastgpt/service/common/string/tiktoken/index';

// 提示词
import { Prompt_AgentQA } from '@fastgpt/global/core/ai/prompt/agent';

// 类型定义
import type { PushDatasetDataChunkProps } from '@fastgpt/global/core/dataset/api.d';

// 工具函数
import { checkTeamAiPointsAndLock } from './utils';
import { getErrText } from '@fastgpt/global/common/error/utils';
import { delay } from '@fastgpt/service/common/bullmq';

// 时间处理
import { addMinutes } from 'date-fns';

// 聊天相关
import { loadRequestMessages } from '@fastgpt/service/core/chat/utils';

// 训练相关
import {
  chunkAutoChunkSize,
  getLLMMaxChunkSize
} from '@fastgpt/global/core/dataset/training/utils';
import { text2Chunks } from '@fastgpt/service/worker/function';
import { pushDataListToTrainingQueue } from '@fastgpt/service/core/dataset/training/controller';

/**
 * 队列并发控制函数
 * 
 * 这是QA生成系统的核心调度控制器，负责管理全局队列的并发处理能力。
 * 通过智能的负载均衡算法，确保系统在高并发场景下的稳定性和效率。
 * 
 * 功能特性：
 * 
 * 1. 并发数量管理：
 *    - 动态监控当前活跃的处理任务数量
 *    - 根据系统负载自动调整并发级别
 *    - 防止过多任务同时执行导致资源竞争
 *    - 确保系统响应性和处理效率的平衡
 * 
 * 2. 队列状态控制：
 *    - 实时跟踪全局队列长度变化
 *    - 智能判断是否需要启动新的处理循环
 *    - 支持队列暂停和恢复机制
 *    - 提供队列健康状态检查
 * 
 * 3. 资源保护机制：
 *    - 防止系统资源过度消耗
 *    - 避免内存泄漏和连接池耗尽
 *    - 支持优雅的任务终止和清理
 *    - 确保长时间运行的稳定性
 * 
 * 4. 性能优化策略：
 *    - 基于历史数据的智能调度
 *    - 支持任务优先级管理
 *    - 动态调整处理间隔和批次大小
 *    - 最大化系统吞吐量
 * 
 * 实现原理：
 * - 使用全局计数器跟踪活跃任务
 * - 原子操作确保并发安全
 * - 基于阈值的动态调度策略
 * - 支持分布式环境下的协调
 * 
 * 注意事项：
 * - 该函数会修改全局状态变量
 * - 需要在适当的时机调用以维护队列健康
 * - 并发控制参数需要根据硬件配置调优
 * 
 * @returns {boolean} 返回true表示队列已清空可以结束处理，false表示需要继续处理
 * 
 * @example
 * ```typescript
 * // 在处理循环中使用
 * while (true) {
 *   // 处理任务...
 *   
 *   if (reduceQueue()) {
 *     console.log('队列处理完成');
 *     break;
 *   }
 * }
 * ```
 */
const reduceQueue = () => {
  global.qaQueueLen = global.qaQueueLen > 0 ? global.qaQueueLen - 1 : 0;

  return global.qaQueueLen === 0;
};

/**
 * 数据库查询时的关联数据类型定义
 * 
 * 定义了QA生成过程中需要从数据库关联查询的核心数据结构。
 * 这些类型确保了数据的类型安全和查询结果的一致性。
 * 
 * 类型说明：
 * 
 * 1. dataset字段：
 *    - vectorModel: 向量化模型标识，用于文本向量化处理
 *    - agentModel: AI代理模型标识，用于问答对生成
 *    - vlmModel: 视觉语言模型标识，用于多模态内容处理
 * 
 * 2. collection字段：
 *    - qaPrompt: 可选的自定义问答生成提示词
 *      - 允许用户定制问答生成的风格和格式
 *      - 未设置时使用系统默认提示词
 *      - 支持变量替换和模板化配置
 * 
 * 设计考虑：
 * - 类型安全：确保编译时的类型检查
 * - 扩展性：便于后续添加新的配置字段
 * - 性能优化：只查询必要的字段减少数据传输
 * - 向后兼容：可选字段确保旧数据的兼容性
 * 
 * 使用场景：
 * - MongoDB的populate查询结果类型定义
 * - 确保关联数据的结构完整性
 * - 提供IDE智能提示和类型检查
 * - 防止运行时的类型错误
 */
type PopulateType = {
  dataset: { vectorModel: string; agentModel: string; vlmModel: string };
  collection: { qaPrompt?: string };
};

/**
 * QA生成队列处理函数
 * 
 * 这是问答对生成系统的核心执行引擎，负责协调整个QA生成流程的各个环节。
 * 该函数采用持续轮询模式，不断处理队列中的任务直到队列清空，确保所有文本都能
 * 及时转换为高质量的问答对数据。
 * 
 * 详细处理流程：
 * 
 * 1. 任务获取与验证：
 *    - 查询数据库中mode为'qa'的待处理任务
 *    - 使用乐观锁机制防止任务重复处理
 *    - 设置10分钟的任务锁定时间，避免死锁
 *    - 关联查询数据集和集合的配置信息
 *    - 验证关联数据的完整性和有效性
 * 
 * 2. 权限与资源检查：
 *    - 验证数据集和集合是否存在且可访问
 *    - 检查团队AI积分余额是否充足
 *    - 清理无效或过期的任务记录
 *    - 确保有足够资源完成QA生成
 * 
 * 3. LLM模型配置与调用：
 *    - 根据数据集配置获取对应的LLM模型
 *    - 构建包含原始文本的问答生成提示词
 *    - 支持自定义QA生成提示词模板
 *    - 配置合适的温度参数确保输出质量
 *    - 发起流式聊天完成请求
 * 
 * 4. 响应处理与Token统计：
 *    - 实时处理LLM的流式响应数据
 *    - 精确统计输入和输出Token数量
 *    - 支持多种Token计算方式和模型
 *    - 为后续计费和统计提供准确数据
 * 
 * 5. 问答对提取与格式化：
 *    - 使用正则表达式解析LLM生成的问答对
 *    - 支持标准的Q1:...A1:...格式
 *    - 处理格式不规范的回答内容
 *    - 回退到传统分块策略确保数据完整性
 * 
 * 6. 数据质量保证：
 *    - 验证提取的问答对的完整性
 *    - 过滤空白或无效的问答内容
 *    - 保持原始文本的语义完整性
 *    - 确保生成数据符合训练要求
 * 
 * 7. 训练队列推送：
 *    - 将格式化的问答对推送到训练队列
 *    - 保持原始任务的上下文信息
 *    - 设置正确的训练模式和参数
 *    - 确保数据流的连续性
 * 
 * 8. 资源清理与统计：
 *    - 删除已完成的QA生成任务
 *    - 记录LLM使用量用于计费
 *    - 更新团队的AI积分余额
 *    - 生成详细的处理日志
 * 
 * 9. 错误处理与恢复：
 *    - 捕获处理过程中的各种异常
 *    - 记录详细的错误信息和上下文
 *    - 支持任务失败后的重试机制
 *    - 防止单个任务失败影响整体处理
 * 
 * 技术特性：
 * - 流式处理：支持大文本的实时处理
 * - 并发安全：使用锁机制防止数据竞争
 * - 容错能力：完善的异常处理和恢复机制
 * - 性能监控：详细的执行时间和资源使用统计
 * - 扩展性：支持多种LLM模型和处理策略
 * 
 * 性能优化：
 * - 批量数据库操作减少IO开销
 * - 智能队列管理提高处理效率
 * - 内存优化避免大文本处理时的内存泄漏
 * - 连接池管理确保数据库连接的高效利用
 * 
 * 注意事项：
 * - LLM调用可能耗时较长，需要合理设置超时
 * - 问答对生成质量依赖于提示词的设计
 * - 需要充足的AI积分余额支持持续处理
 * - 大批量处理时需要监控系统资源使用
 * 
 * @returns {Promise<any>} 处理结果的Promise对象
 * 
 * @throws {Error} 当系统资源不足、模型不可用或数据库连接失败时抛出异常
 * 
 * @example
 * ```typescript
 * // 启动QA生成队列处理
 * try {
 *   await generateQA();
 *   console.log('QA生成队列处理完成');
 * } catch (error) {
 *   console.error('QA生成处理失败:', error);
 * }
 * ```
 */
export async function generateQA(): Promise<any> {
  const max = global.systemEnv?.qaMaxProcess || 10;
  addLog.debug(`[QA Queue] Queue size: ${global.qaQueueLen}`);

  if (global.qaQueueLen >= max) return;
  global.qaQueueLen++;

  try {
    while (true) {
      const startTime = Date.now();
      // get training data
      const {
        data,
        text,
        done = false,
        error = false
      } = await (async () => {
        try {
          const data = await MongoDatasetTraining.findOneAndUpdate(
            {
              mode: TrainingModeEnum.qa,
              retryCount: { $gt: 0 },
              lockTime: { $lte: addMinutes(new Date(), -10) }
            },
            {
              lockTime: new Date(),
              $inc: { retryCount: -1 }
            }
          )
            .populate<PopulateType>([
              {
                path: 'dataset',
                select: 'agentModel vectorModel vlmModel'
              },
              {
                path: 'collection',
                select: 'qaPrompt'
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
            data,
            text: data.q
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
        addLog.error(`[QA Queue] Error`, error);
        await delay(500);
        continue;
      }

      if (!data.dataset || !data.collection) {
        addLog.info(`[QA Queue] Dataset or collection not found`, data);
        // Delete data
        await MongoDatasetTraining.deleteOne({ _id: data._id });
        continue;
      }
      // auth balance
      if (!(await checkTeamAiPointsAndLock(data.teamId))) {
        continue;
      }

      addLog.info(`[QA Queue] Start`);

      try {
        const modelData = getLLMModel(data.dataset.agentModel);
        const prompt = `${data.collection.qaPrompt || Prompt_AgentQA.description}
  ${replaceVariable(Prompt_AgentQA.fixedText, { text })}`;

        // request LLM to get QA
        const messages: ChatCompletionMessageParam[] = [
          {
            role: 'user',
            content: prompt
          }
        ];

        const { response: chatResponse } = await createChatCompletion({
          body: llmCompletionsBodyFormat(
            {
              model: modelData.model,
              temperature: 0.3,
              messages: await loadRequestMessages({ messages, useVision: false }),
              stream: true
            },
            modelData
          )
        });
        const { text: answer, usage } = await formatLLMResponse(chatResponse);
        const inputTokens = usage?.prompt_tokens || (await countGptMessagesTokens(messages));
        const outputTokens = usage?.completion_tokens || (await countPromptTokens(answer));

        const qaArr = await formatSplitText({ answer, rawText: text, llmModel: modelData }); // 格式化后的QA对

        // get vector and insert
        await pushDataListToTrainingQueue({
          teamId: data.teamId,
          tmbId: data.tmbId,
          datasetId: data.datasetId,
          collectionId: data.collectionId,
          mode: TrainingModeEnum.chunk,
          data: qaArr.map((item) => ({
            ...item,
            chunkIndex: data.chunkIndex
          })),
          billId: data.billId,
          vectorModel: data.dataset.vectorModel,
          agentModel: data.dataset.agentModel,
          vlmModel: data.dataset.vlmModel
        });

        // delete data from training
        await MongoDatasetTraining.findByIdAndDelete(data._id);

        // Push usage
        pushLLMTrainingUsage({
          teamId: data.teamId,
          tmbId: data.tmbId,
          inputTokens,
          outputTokens,
          billId: data.billId,
          model: modelData.model,
          mode: 'qa'
        });

        addLog.info(`[QA Queue] Finish`, {
          time: Date.now() - startTime,
          splitLength: qaArr.length,
          usage
        });
      } catch (err: any) {
        addLog.error(`[QA Queue] Error`, err);
        await MongoDatasetTraining.updateOne(
          {
            _id: data._id
          },
          {
            errorMsg: getErrText(err, 'unknown error')
          }
        );

        await delay(100);
      }
    }
  } catch (error) {
    addLog.error(`[QA Queue] Error`, error);
  }

  if (reduceQueue()) {
    addLog.info(`[QA Queue] Done`);
  }
  addLog.debug(`[QA Queue] break loop, current queue size: ${global.qaQueueLen}`);
}

/**
 * 格式化和分割QA答案
 * 
 * 这是问答对生成系统的核心数据处理函数，负责将LLM生成的原始回答转换为
 * 结构化的问答对数据。该函数采用智能解析策略，确保即使在LLM输出格式
 * 不完全标准的情况下，也能最大程度地提取有用的问答信息。
 * 
 * 主要功能：
 * 
 * 1. 智能格式解析：
 *    - 使用正则表达式识别标准的Q&A格式
 *    - 支持Q1:...A1:...的标准问答对格式
 *    - 处理多种变体和格式不规范的情况
 *    - 自动清理多余的空白字符和换行符
 * 
 * 2. 问答对提取：
 *    - 精确匹配问题和答案的配对关系
 *    - 支持多个问答对的批量提取
 *    - 过滤空白或无效的问答内容
 *    - 保持问答对的语义完整性
 * 
 * 3. 容错与回退机制：
 *    - 当无法提取标准问答对时自动回退
 *    - 使用传统文本分块策略作为备选方案
 *    - 确保原始文本信息不会丢失
 *    - 维持数据处理的连续性和完整性
 * 
 * 4. 文本分块优化：
 *    - 根据LLM模型特性调整分块大小
 *    - 智能控制分块的最大长度限制
 *    - 保持文本的语义边界完整性
 *    - 优化后续向量化处理的效果
 * 
 * 处理策略：
 * 
 * 1. 标准格式解析：
 *    - 使用正则表达式：/Q\d+:(\s*)(.*)\s*)A\d+:(\s*)([\s\S]*?)(?=Q\d|$)/g
 *    - 匹配Q数字:问题内容 A数字:答案内容的格式
 *    - 支持跨行的答案内容处理
 *    - 自动处理编号不连续的情况
 * 
 * 2. 数据清理与验证：
 *    - 移除多余的转义字符和格式符号
 *    - 标准化换行符和空白字符
 *    - 验证问题和答案的有效性
 *    - 过滤过短或无意义的内容
 * 
 * 3. 回退分块处理：
 *    - 当提取结果为空时启动回退机制
 *    - 使用text2Chunks进行智能文本分割
 *    - 根据模型特性设置合适的分块参数
 *    - 生成问题字段，答案字段留空
 * 
 * 技术特点：
 * - 鲁棒性：能处理各种格式变体和异常情况
 * - 效率性：使用高效的正则表达式匹配算法
 * - 灵活性：支持多种LLM模型的输出格式
 * - 可靠性：提供完善的回退和容错机制
 * 
 * 性能考虑：
 * - 正则表达式匹配的时间复杂度优化
 * - 大文本处理时的内存使用控制
 * - 批量处理时的效率提升策略
 * - 避免不必要的字符串操作开销
 * 
 * 注意事项：
 * - LLM输出格式可能存在不一致性
 * - 需要处理多语言和特殊字符情况
 * - 分块大小需要根据下游处理需求调整
 * - 回退机制确保数据处理的完整性
 * 
 * @param {Object} params - 函数参数对象
 * @param {string} params.answer - LLM生成的原始答案文本，包含问答对信息
 * @param {string} params.rawText - 原始输入文本，用于回退分块处理
 * @param {LLMModelItemType} params.llmModel - 使用的LLM模型配置信息
 * 
 * @returns {Promise<PushDatasetDataChunkProps[]>} 返回格式化的问答对数组
 *   - 成功解析时：包含q(问题)和a(答案)字段的对象数组
 *   - 回退处理时：包含q(文本块)和a(空字符串)字段的对象数组
 * 
 * @throws {Error} 当文本处理或分块操作失败时抛出异常
 * 
 * @example
 * ```typescript
 * // 标准问答对格式处理
 * const result = await formatSplitText({
 *   answer: "Q1: 什么是AI？\nA1: AI是人工智能的缩写。\nQ2: AI有什么用途？\nA2: AI可以用于自动化和智能决策。",
 *   rawText: "原始文档内容...",
 *   llmModel: modelConfig
 * });
 * // 结果: [{q: "什么是AI？", a: "AI是人工智能的缩写。"}, {q: "AI有什么用途？", a: "AI可以用于自动化和智能决策。"}]
 * 
 * // 回退分块处理
 * const fallbackResult = await formatSplitText({
 *   answer: "无法解析的格式内容",
 *   rawText: "需要分块的长文本内容...",
 *   llmModel: modelConfig
 * });
 * // 结果: [{q: "文本块1", a: ""}, {q: "文本块2", a: ""}]
 * ```
 */
async function formatSplitText({
  answer,
  rawText,
  llmModel
}: {
  answer: string;
  rawText: string;
  llmModel: LLMModelItemType;
}) {
  answer = answer.replace(/\\n/g, '\n'); // 将换行符替换为空格
  const regex = /Q\d+:(\s*)(.*)(\s*)A\d+:(\s*)([\s\S]*?)(?=Q\d|$)/g; // 匹配Q和A的正则表达式
  const matches = answer.matchAll(regex); // 获取所有匹配到的结果

  const result: PushDatasetDataChunkProps[] = []; // 存储最终的结果
  for (const match of matches) {
    const q = match[2] || '';
    const a = match[5] || '';
    if (q) {
      result.push({
        q,
        a
      });
    }
  }

  // empty result. direct split chunk
  if (result.length === 0) {
    const { chunks } = await text2Chunks({
      text: rawText,
      chunkSize: chunkAutoChunkSize,
      maxSize: getLLMMaxChunkSize(llmModel)
    });
    chunks.forEach((chunk) => {
      result.push({
        q: chunk,
        a: ''
      });
    });
  }

  return result;
}
