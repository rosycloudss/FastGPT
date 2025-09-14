/**
 * QA生成队列模块
 * 负责使用LLM从原始文本生成问答对，用于数据集训练
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
 * 减少队列计数器
 * 用于管理全局QA队列的并发数量
 * @returns 是否队列已清空
 */
const reduceQueue = () => {
  global.qaQueueLen = global.qaQueueLen > 0 ? global.qaQueueLen - 1 : 0;

  return global.qaQueueLen === 0;
};

/**
 * 数据库关联查询类型定义
 */
type PopulateType = {
  dataset: { vectorModel: string; agentModel: string; vlmModel: string };
  collection: { qaPrompt?: string };
};

/**
 * QA生成主函数
 * 处理流程：
 * 1. 检查队列容量限制
 * 2. 获取待处理的训练数据
 * 3. 使用LLM生成问答对
 * 4. 格式化和分割生成的QA内容
 * 5. 推送到训练队列
 * 6. 记录使用量和清理任务
 * @returns Promise<any>
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
 * 从LLM生成的答案中提取问答对，如果提取失败则直接分块
 * @param answer - LLM生成的答案文本
 * @param rawText - 原始文本
 * @param llmModel - 使用的LLM模型
 * @returns 格式化后的问答对数组
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
