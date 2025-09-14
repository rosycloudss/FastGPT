/**
 * AI向量化处理模块
 * 
 * 该模块负责将文本转换为向量表示，是RAG系统中的核心组件之一。
 * 主要功能包括：
 * 1. 文本向量化：将输入文本转换为高维向量
 * 2. 批量处理：支持大量文本的批量向量化
 * 3. 向量标准化：统一向量维度和数值范围
 * 4. 多模型支持：支持不同的embedding模型
 * 5. 配置管理：根据使用场景应用不同配置
 * 
 * 核心功能：
 * - getVectorsByText: 文本向量化的主要接口
 * - unityDimensional: 向量维度统一处理
 * - normalization: 向量标准化处理
 */

import { type EmbeddingModelItemType } from '@fastgpt/global/core/ai/model.d';
import { getAIApi } from '../config';
import { countPromptTokens } from '../../../common/string/tiktoken/index';
import { EmbeddingTypeEnm } from '@fastgpt/global/core/ai/constants';
import { addLog } from '../../../common/system/log';

/**
 * 向量化处理参数类型定义
 */
type GetVectorProps = {
  /** embedding模型配置信息 */
  model: EmbeddingModelItemType;
  /** 待向量化的输入文本，支持单个字符串或字符串数组 */
  input: string[] | string;
  /** 向量化类型，用于区分数据库存储和查询场景 */
  type?: `${EmbeddingTypeEnm}`;
  /** 自定义HTTP请求头 */
  headers?: Record<string, string>;
};

/**
 * 将文本转换为向量表示
 * 
 * 这是向量化处理的核心函数，负责：
 * 1. 输入验证和格式化
 * 2. 批量处理优化（每批20个文本）
 * 3. 调用AI API进行向量化
 * 4. 向量后处理（维度统一、标准化）
 * 5. Token计数和使用量统计
 * 
 * 支持两种向量化类型：
 * - db: 用于数据库存储的向量化，可能使用特定的配置
 * - query: 用于查询的向量化，可能使用不同的配置以提高检索效果
 * 
 * @param params - 向量化参数
 * @param params.model - embedding模型配置
 * @param params.input - 待向量化的文本（字符串或字符串数组）
 * @param params.type - 向量化类型（db/query）
 * @param params.headers - 自定义请求头
 * 
 * @returns Promise<{tokens: number, vectors: number[][]}> - 返回token数量和向量数组
 * 
 * @throws 当输入为空或API调用失败时抛出错误
 * 
 * @example
 * ```typescript
 * // 单个文本向量化
 * const result = await getVectorsByText({
 *   model: embeddingModel,
 *   input: '这是一段测试文本',
 *   type: EmbeddingTypeEnm.query
 * });
 * 
 * // 批量文本向量化
 * const batchResult = await getVectorsByText({
 *   model: embeddingModel,
 *   input: ['文本1', '文本2', '文本3'],
 *   type: EmbeddingTypeEnm.db
 * });
 * ```
 */
export async function getVectorsByText({ model, input, type, headers }: GetVectorProps) {
  // 1. 输入验证
  if (!input) {
    return Promise.reject({
      code: 500,
      message: 'input is empty'
    });
  }
  
  // 2. 获取AI API实例
  const ai = getAIApi();

  // 3. 输入格式化：确保输入为数组格式
  const formatInput = Array.isArray(input) ? input : [input];

  // 4. 批量处理配置：每批处理20个文本，避免单次请求过大
  const chunkSize = 20;
  const chunks = [];
  for (let i = 0; i < formatInput.length; i += chunkSize) {
    chunks.push(formatInput.slice(i, i + chunkSize));
  }

  try {
    // 5. 顺序处理各个批次
    let totalTokens = 0;           // 累计token使用量
    const allVectors: number[][] = []; // 存储所有向量结果

    for (const chunk of chunks) {
      // 6. 调用embedding API进行向量化
      const result = await ai.embeddings
        .create(
          {
            ...model.defaultConfig,  // 模型默认配置
            // 根据向量化类型应用特定配置
            ...(type === EmbeddingTypeEnm.db && model.dbConfig),     // 数据库存储配置
            ...(type === EmbeddingTypeEnm.query && model.queryConfig), // 查询配置
            model: model.model,      // 模型名称
            input: chunk             // 当前批次的文本
          },
          // 请求配置：支持自定义URL和认证
          model.requestUrl
            ? {
                path: model.requestUrl,  // 自定义API端点
                headers: {
                  // 添加认证头（如果配置了）
                  ...(model.requestAuth ? { Authorization: `Bearer ${model.requestAuth}` } : {}),
                  ...headers             // 合并自定义请求头
                }
              }
            : { headers }              // 仅使用自定义请求头
        )
        .then(async (res) => {
          // 7. 响应验证和错误处理
          if (!res.data) {
            addLog.error('Embedding API is not responding', res);
            return Promise.reject('Embedding API is not responding');
          }
          if (!res?.data?.[0]?.embedding) {
            console.log(res);
            // @ts-ignore
            return Promise.reject(res.data?.err?.message || 'Embedding API Error');
          }

          // 8. 并行处理token计数和向量后处理
          const [tokens, vectors] = await Promise.all([
            // Token计数：优先使用API返回的usage，否则手动计算
            (async () => {
              if (res.usage) return res.usage.total_tokens;

              // 手动计算每个文本的token数量
              const tokens = await Promise.all(chunk.map((item) => countPromptTokens(item)));
              return tokens.reduce((sum, item) => sum + item, 0);
            })(),
            // 向量后处理：维度统一和标准化
            Promise.all(
              res.data
                .map((item) => unityDimensional(item.embedding))  // 统一向量维度
                .map((item) => {
                  // 根据模型配置决定是否进行标准化
                  if (model.normalization) return normalization(item);
                  return item;
                })
            )
          ]);

          return {
            tokens,   // 当前批次的token使用量
            vectors   // 当前批次的向量结果
          };
        });

      // 9. 累积结果
      totalTokens += result.tokens;           // 累加token使用量
      allVectors.push(...result.vectors);     // 合并向量结果
    }

    // 10. 返回最终结果
    return {
      tokens: totalTokens,  // 总token使用量
      vectors: allVectors   // 所有文本的向量表示
    };
  } catch (error) {
    // 11. 错误处理和日志记录
    addLog.error(`Embedding Error`, error);
    return Promise.reject(error);
  }
}

/**
 * 统一向量维度处理
 * 
 * 将不同模型产生的向量统一到1536维，这是为了：
 * 1. 兼容不同embedding模型的输出维度
 * 2. 优化存储空间和计算效率
 * 3. 确保向量数据库的一致性
 * 
 * 处理策略：
 * - 如果向量维度超过1536，截取前1536维
 * - 如果向量维度不足1536，用0填充到1536维
 * 
 * @param vector - 原始向量数组
 * @returns number[] - 统一为1536维的向量
 * 
 * @example
 * ```typescript
 * // 处理超长向量（截取）
 * const longVector = new Array(2048).fill(0.1);
 * const unified1 = unityDimensional(longVector); // 长度为1536
 * 
 * // 处理短向量（填充）
 * const shortVector = new Array(512).fill(0.1);
 * const unified2 = unityDimensional(shortVector); // 长度为1536，后面用0填充
 * ```
 */
function unityDimensional(vector: number[]) {
  // 处理超长向量：截取前1536维
  if (vector.length > 1536) {
    console.log(
      `The current vector dimension is ${vector.length}, and the vector dimension cannot exceed 1536. The first 1536 dimensions are automatically captured`
    );
    return vector.slice(0, 1536);
  }
  
  let resultVector = vector;
  const vectorLen = vector.length;

  // 处理短向量：用0填充到1536维
  const zeroVector = new Array(1536 - vectorLen).fill(0);

  return resultVector.concat(zeroVector);
}
/**
 * 向量标准化处理
 * 
 * 对向量进行L2标准化（单位向量化），将向量的模长标准化为1。
 * 这样做的好处：
 * 1. 消除向量幅度差异，使相似度计算更准确
 * 2. 提高向量检索的稳定性和一致性
 * 3. 优化余弦相似度计算（标准化后余弦相似度等于点积）
 * 
 * 处理逻辑：
 * - 如果向量中存在大于1的值，进行L2标准化
 * - 否则保持原向量不变（可能已经标准化）
 * 
 * @param vector - 待标准化的向量
 * @returns number[] - 标准化后的向量
 * 
 * @example
 * ```typescript
 * // 标准化大幅度向量
 * const largeVector = [3, 4, 0]; // 模长为5
 * const normalized = normalization(largeVector); // [0.6, 0.8, 0] 模长为1
 * 
 * // 已标准化的向量保持不变
 * const smallVector = [0.6, 0.8, 0];
 * const unchanged = normalization(smallVector); // [0.6, 0.8, 0]
 * ```
 */
function normalization(vector: number[]) {
  // 检查是否需要标准化：如果存在大于1的值则需要标准化
  if (vector.some((item) => item > 1)) {
    // 计算欧几里得范数（L2范数）：||v|| = sqrt(v1² + v2² + ... + vn²)
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));

    // 标准化：将每个分量除以范数，得到单位向量
    return vector.map((val) => val / norm);
  }

  // 如果向量值都小于等于1，可能已经标准化，直接返回
  return vector;
}
