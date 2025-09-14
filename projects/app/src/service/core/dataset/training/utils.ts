/**
 * 数据集训练工具模块
 * 
 * 提供数据集训练相关的核心功能，主要包括：
 * - MongoDB 变更流监听，自动触发训练队列
 * - 训练队列启动和管理
 * - 根据训练模式分发到不同的处理队列
 * 
 * @module dataset/training/utils
 */

// QA生成队列处理
import { generateQA } from '@/service/core/dataset/queues/generateQA';
// 向量生成队列处理
import { generateVector } from '@/service/core/dataset/queues/generateVector';
// 训练模式枚举
import { TrainingModeEnum } from '@fastgpt/global/core/dataset/constants';
// 数据集训练数据类型定义
import { type DatasetTrainingSchemaType } from '@fastgpt/global/core/dataset/type';
// 数据集训练MongoDB模型
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
// 数据集解析队列处理
import { datasetParseQueue } from '../queues/datasetParse';

/**
 * 创建数据集训练MongoDB变更流监听器
 * 
 * 该函数创建一个MongoDB变更流监听器，用于监听训练数据的插入操作：
 * 1. 监听 MongoDatasetTraining 集合的变更
 * 2. 当有新的训练任务插入时，根据训练模式自动触发相应的队列处理
 * 3. 支持三种训练模式：QA生成、向量生成、数据解析
 * 
 * 训练模式分发逻辑：
 * - TrainingModeEnum.qa: 触发QA生成队列
 * - TrainingModeEnum.chunk: 触发向量生成队列
 * - TrainingModeEnum.parse: 触发数据解析队列
 * 
 * @example
 * ```typescript
 * // 在应用启动时创建监听器
 * createDatasetTrainingMongoWatch();
 * ```
 */
export const createDatasetTrainingMongoWatch = () => {
  // 创建MongoDB变更流
  const changeStream = MongoDatasetTraining.watch();

  // 监听变更事件
  changeStream.on('change', async (change) => {
    try {
      // 只处理插入操作
      if (change.operationType === 'insert') {
        const fullDocument = change.fullDocument as DatasetTrainingSchemaType;
        const { mode } = fullDocument;
        
        // 根据训练模式分发到不同队列
        if (mode === TrainingModeEnum.qa) {
          // 触发QA生成队列
          generateQA();
        } else if (mode === TrainingModeEnum.chunk) {
          // 触发向量生成队列
          generateVector();
        } else if (mode === TrainingModeEnum.parse) {
          // 触发数据解析队列
          datasetParseQueue();
        }
      }
    } catch (error) {
      // 忽略处理过程中的错误，避免影响其他任务
    }
  });
};

/**
 * 启动训练队列处理
 * 
 * 该函数用于手动启动训练队列的处理，支持快速模式和普通模式：
 * - 普通模式：每种队列启动1个处理实例
 * - 快速模式：每种队列启动多个处理实例（最大数量由系统环境变量控制）
 * 
 * @param fast - 是否启用快速模式，默认为false
 *               - true: 启动最大数量的处理实例（由 qaMaxProcess 环境变量控制，默认10个）
 *               - false: 每种队列只启动1个处理实例
 * 
 * @example
 * ```typescript
 * // 普通模式启动
 * startTrainingQueue();
 * 
 * // 快速模式启动（用于处理积压任务）
 * startTrainingQueue(true);
 * ```
 */
export const startTrainingQueue = (fast?: boolean) => {
  // 获取最大处理进程数，默认为10
  const max = global.systemEnv?.qaMaxProcess || 10;

  // 根据模式决定启动的实例数量
  for (let i = 0; i < (fast ? max : 1); i++) {
    // 启动QA生成队列处理
    generateQA();
    // 启动向量生成队列处理
    generateVector();
    // 启动数据解析队列处理
    datasetParseQueue();
  }
};
