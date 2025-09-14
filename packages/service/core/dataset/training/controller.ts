/**
 * 数据集训练控制器模块
 * 
 * 该模块负责处理数据集的训练队列管理，包括：
 * 1. 数据预处理和验证
 * 2. 批量数据插入到训练队列
 * 3. 不同训练模式的处理（chunk、qa、auto、image等）
 * 4. 模型配置验证和参数设置
 * 5. 数据库事务管理
 * 
 * 核心功能：
 * - pushDataListToTrainingQueue: 批量推送数据到训练队列
 * - pushDatasetToParseQueue: 推送数据集到解析队列
 * - lockTrainingDataByTeamId: 锁定团队的训练数据
 */

import { MongoDatasetTraining } from './schema';
import type {
  PushDatasetDataChunkProps,
  PushDatasetDataResponse
} from '@fastgpt/global/core/dataset/api.d';
import { TrainingModeEnum } from '@fastgpt/global/core/dataset/constants';
import { simpleText } from '@fastgpt/global/common/string/tools';
import { type ClientSession } from '../../../common/mongo';
import { getLLMModel, getEmbeddingModel, getVlmModel } from '../../ai/model';
import { addLog } from '../../../common/system/log';
import { getCollectionWithDataset } from '../controller';
import { mongoSessionRun } from '../../../common/mongo/sessionRun';
import { type PushDataToTrainingQueueProps } from '@fastgpt/global/core/dataset/training/type';
import { i18nT } from '../../../../web/i18n/utils';
import { getLLMMaxChunkSize } from '../../../../global/core/dataset/training/utils';

/**
 * 锁定指定团队的所有训练数据
 * 
 * 通过设置一个未来的锁定时间来防止训练数据被并发处理。
 * 这是一个安全机制，用于在特定情况下暂停团队的所有训练任务。
 * 
 * @param teamId - 团队ID
 * @returns Promise<any> - 更新操作的结果
 * 
 * @example
 * ```typescript
 * await lockTrainingDataByTeamId('team_123');
 * ```
 */
export const lockTrainingDataByTeamId = async (teamId: string): Promise<any> => {
  try {
    // 将锁定时间设置为一个遥远的未来时间（2999年），实现长期锁定
    await MongoDatasetTraining.updateMany(
      {
        teamId // 匹配指定团队的所有训练数据
      },
      {
        lockTime: new Date('2999/5/5') // 设置锁定时间为未来时间
      }
    );
  } catch (error) {
    // 静默处理错误，不抛出异常
  }
};

/**
 * 批量推送数据列表到训练队列
 * 
 * 这是数据集训练的核心函数，负责：
 * 1. 验证和配置不同类型的AI模型（LLM、Embedding、VLM）
 * 2. 根据训练模式设置相应的参数和限制
 * 3. 数据预处理：过滤、验证、格式化
 * 4. 批量插入数据到MongoDB训练队列
 * 5. 事务管理确保数据一致性
 * 
 * 支持的训练模式：
 * - chunk: 文本分块模式，使用embedding模型
 * - qa: 问答模式，使用LLM模型
 * - auto: 自动模式，使用LLM模型
 * - image: 图像模式，使用VLM模型
 * - imageParse: 图像解析模式，使用VLM模型
 * 
 * @param params - 训练队列推送参数
 * @param params.teamId - 团队ID
 * @param params.tmbId - 团队成员ID
 * @param params.datasetId - 数据集ID
 * @param params.collectionId - 集合ID
 * @param params.agentModel - LLM模型名称
 * @param params.vectorModel - 向量模型名称
 * @param params.vlmModel - 视觉语言模型名称
 * @param params.data - 待训练的数据列表
 * @param params.billId - 账单ID
 * @param params.mode - 训练模式，默认为chunk
 * @param params.indexSize - 索引大小
 * @param params.session - MongoDB会话（可选）
 * 
 * @returns Promise<PushDatasetDataResponse> - 包含插入数据数量的响应
 * 
 * @throws 当模型配置无效或训练模式不支持时抛出错误
 * 
 * @example
 * ```typescript
 * const result = await pushDataListToTrainingQueue({
 *   teamId: 'team_123',
 *   tmbId: 'member_456',
 *   datasetId: 'dataset_789',
 *   collectionId: 'collection_abc',
 *   agentModel: 'gpt-3.5-turbo',
 *   vectorModel: 'text-embedding-ada-002',
 *   data: [{ q: '问题', a: '答案' }],
 *   billId: 'bill_def',
 *   mode: TrainingModeEnum.qa
 * });
 * console.log(`成功插入 ${result.insertLen} 条数据`);
 * ```
 */
export async function pushDataListToTrainingQueue({
  teamId,
  tmbId,
  datasetId,
  collectionId,
  agentModel,
  vectorModel,
  vlmModel,
  data,
  billId,
  mode = TrainingModeEnum.chunk,
  indexSize,
  session
}: PushDataToTrainingQueueProps): Promise<PushDatasetDataResponse> {
  // 1. 模型配置验证
  // 获取并验证向量模型配置
  const vectorModelData = getEmbeddingModel(vectorModel);
  if (!vectorModelData) {
    return Promise.reject(i18nT('common:error_embedding_not_config'));
  }
  
  // 获取并验证LLM模型配置
  const agentModelData = getLLMModel(agentModel);
  if (!agentModelData) {
    return Promise.reject(i18nT('common:error_llm_not_config'));
  }

  // 2. 根据训练模式配置模型参数
  const { model, maxToken, weight } = await (async () => {
    // 文本分块模式：使用embedding模型进行向量化
    if (mode === TrainingModeEnum.chunk) {
      return {
        maxToken: Infinity, // 分块模式不限制token数量
        model: vectorModelData.model,
        weight: vectorModelData.weight // 使用向量模型的权重
      };
    }
    
    // 问答模式和自动模式：使用LLM模型进行文本生成
    if (mode === TrainingModeEnum.qa || mode === TrainingModeEnum.auto) {
      return {
        maxToken: getLLMMaxChunkSize(agentModelData), // 获取LLM模型的最大分块大小
        model: agentModelData.model,
        weight: 0 // LLM模式不使用权重
      };
    }
    
    // 图像模式和图像解析模式：使用视觉语言模型
    if (mode === TrainingModeEnum.image || mode === TrainingModeEnum.imageParse) {
      const vllmModelData = getVlmModel(vlmModel);
      if (!vllmModelData) {
        return Promise.reject(i18nT('common:error_vlm_not_config'));
      }
      return {
        maxToken: getLLMMaxChunkSize(vllmModelData), // 获取VLM模型的最大分块大小
        model: vllmModelData.model,
        weight: 0 // VLM模式不使用权重
      };
    }

    // 不支持的训练模式
    return Promise.reject(`Training mode "${mode}" is inValid`);
  })();

  // 3. 数据预处理和过滤
  data = data.filter((item) => {
    const q = item.q || ''; // 问题文本
    const a = item.a || ''; // 答案文本

    // 过滤无效数据：既没有图像ID也没有问题文本的数据
    if (!item.imageId && !q) {
      return false;
    }

    const text = q + a; // 合并问答文本用于长度检查

    // 过滤超长文本：超过模型最大token限制的数据
    if (text.length > maxToken) {
      return false;
    }

    return true; // 保留有效数据
  });

  // 4. 批量数据插入处理
  const insertLen = data.length; // 记录待插入数据总数

  // 批量插入配置：每批处理500条数据，避免单次操作过大
  const batchSize = 500;
  
  /**
   * 递归批量插入数据的内部函数
   * 
   * @param startIndex - 当前批次的起始索引
   * @param session - MongoDB会话对象
   */
  const insertData = async (startIndex: number, session: ClientSession) => {
    // 获取当前批次的数据切片
    const list = data.slice(startIndex, startIndex + batchSize);

    // 如果没有更多数据，结束递归
    if (list.length === 0) return;

    try {
      // 执行批量插入操作
      const result = await MongoDatasetTraining.insertMany(
        // 将数据转换为训练记录格式
        list.map((item) => ({
          teamId,                              // 团队ID
          tmbId,                               // 团队成员ID
          datasetId: datasetId,                // 数据集ID
          collectionId: collectionId,          // 集合ID
          billId,                              // 账单ID
          mode,                                // 训练模式
          ...(item.q && { q: item.q }),        // 问题文本（如果存在）
          ...(item.a && { a: item.a }),        // 答案文本（如果存在）
          ...(item.imageId && { imageId: item.imageId }), // 图像ID（如果存在）
          chunkIndex: item.chunkIndex ?? 0,    // 分块索引，默认为0
          indexSize,                           // 索引大小
          weight: weight ?? 0,                 // 权重值，默认为0
          indexes: item.indexes,               // 索引信息
          retryCount: 5                        // 重试次数，默认为5
        })),
        {
          session,                             // 使用事务会话
          ordered: false,                      // 无序插入，提高性能
          rawResult: true,                     // 返回原始结果
          includeResultMetadata: false         // 不包含元数据，减少返回数据量
        }
      );

      // 验证插入结果：确保所有数据都成功插入
      if (result.insertedCount !== list.length) {
        return Promise.reject(`Insert data error, ${JSON.stringify(result)}`);
      }
    } catch (error: any) {
      // 记录插入错误并抛出异常
      addLog.error(`Insert error`, error);
      return Promise.reject(error);
    }

    // 递归处理下一批数据
    return insertData(startIndex + batchSize, session);
  };

  // 5. 执行数据插入操作
  if (session) {
    // 如果已提供会话，直接使用现有事务
    await insertData(0, session);
  } else {
    // 如果未提供会话，创建新的事务会话
    await mongoSessionRun(async (session) => {
      await insertData(0, session);
    });
  }

  // 6. 返回插入结果
  return {
    insertLen // 返回成功插入的数据数量
  };
}

/**
 * 推送数据集到解析队列
 * 
 * 创建一个解析模式的训练任务，用于处理需要预解析的数据集。
 * 这通常用于文档解析、格式转换等预处理步骤。
 * 
 * @param params - 解析队列参数
 * @param params.teamId - 团队ID
 * @param params.tmbId - 团队成员ID
 * @param params.datasetId - 数据集ID
 * @param params.collectionId - 集合ID
 * @param params.billId - 账单ID
 * @param params.session - MongoDB事务会话
 * 
 * @returns Promise<void> - 异步操作完成
 * 
 * @example
 * ```typescript
 * await mongoSessionRun(async (session) => {
 *   await pushDatasetToParseQueue({
 *     teamId: 'team_123',
 *     tmbId: 'member_456',
 *     datasetId: 'dataset_789',
 *     collectionId: 'collection_abc',
 *     billId: 'bill_def',
 *     session
 *   });
 * });
 * ```
 */
export const pushDatasetToParseQueue = async ({
  teamId,
  tmbId,
  datasetId,
  collectionId,
  billId,
  session
}: {
  teamId: string;
  tmbId: string;
  datasetId: string;
  collectionId: string;
  billId: string;
  session: ClientSession;
}) => {
  // 创建解析模式的训练任务记录
  await MongoDatasetTraining.create(
    [
      {
        teamId,                           // 团队ID
        tmbId,                            // 团队成员ID
        datasetId,                        // 数据集ID
        collectionId,                     // 集合ID
        billId,                           // 账单ID
        mode: TrainingModeEnum.parse      // 设置为解析模式
      }
    ],
    { 
      session,      // 使用事务会话确保数据一致性
      ordered: true // 有序插入，确保按顺序处理
    }
  );
};
