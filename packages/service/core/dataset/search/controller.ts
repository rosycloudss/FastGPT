/**
 * 数据集检索控制器模块
 * 
 * 该模块是FastGPT RAG系统的核心检索组件，实现了混合检索策略。
 * 主要功能包括：
 * 1. 向量检索：基于语义相似度的检索
 * 2. 全文检索：基于关键词匹配的检索
 * 3. 混合检索：结合向量和全文检索的优势
 * 4. 重排序：使用专门的重排序模型优化结果
 * 5. 过滤机制：支持多维度的数据过滤
 * 6. 查询扩展：智能扩展用户查询以提高召回率
 * 
 * 技术特点：
 * - RRF（Reciprocal Rank Fusion）算法融合多路检索结果
 * - 支持标签、时间等元数据过滤
 * - 动态调整检索参数以平衡精度和召回率
 * - 支持多种评分机制和排序策略
 * - 集成重排序模型提升检索质量
 * 
 * 核心函数：
 * - searchDatasetData: 主要检索接口
 * - datasetDataReRank: 重排序处理
 * - filterDatasetDataByMaxTokens: Token限制过滤
 * - embeddingRecall: 向量检索
 * - fullTextRecall: 全文检索
 */

import {
  DatasetSearchModeEnum,
  DatasetSearchModeMap,
  SearchScoreTypeEnum
} from '@fastgpt/global/core/dataset/constants';
import { recallFromVectorStore } from '../../../common/vectorDB/controller';
import { getVectorsByText } from '../../ai/embedding';
import { getEmbeddingModel, getDefaultRerankModel, getLLMModel } from '../../ai/model';
import { MongoDatasetData } from '../data/schema';
import type {
  DatasetCollectionSchemaType,
  DatasetDataSchemaType
} from '@fastgpt/global/core/dataset/type';
import {
  type DatasetDataTextSchemaType,
  type SearchDataResponseItemType
} from '@fastgpt/global/core/dataset/type';
import { MongoDatasetCollection } from '../collection/schema';
import { reRankRecall } from '../../../core/ai/rerank';
import { countPromptTokens } from '../../../common/string/tiktoken/index';
import { datasetSearchResultConcat } from '@fastgpt/global/core/dataset/search/utils';
import { hashStr } from '@fastgpt/global/common/string/tools';
import { jiebaSplit } from '../../../common/string/jieba/index';
import { getCollectionSourceData } from '@fastgpt/global/core/dataset/collection/utils';
import { Types } from '../../../common/mongo';
import json5 from 'json5';
import { MongoDatasetCollectionTags } from '../tag/schema';
import { readFromSecondary } from '../../../common/mongo/utils';
import { MongoDatasetDataText } from '../data/dataTextSchema';
import { type ChatItemType } from '@fastgpt/global/core/chat/type';
import type { NodeInputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import { datasetSearchQueryExtension } from './utils';
import type { RerankModelItemType } from '@fastgpt/global/core/ai/model.d';
import { formatDatasetDataValue } from '../data/controller';

/**
 * 数据集检索参数类型定义
 * 
 * 定义了数据集检索的所有输入参数，支持多种检索模式和过滤条件。
 */
export type SearchDatasetDataProps = {
  /** 对话历史，用于上下文理解 */
  histories: ChatItemType[];
  /** 团队ID，用于数据隔离 */
  teamId: string;
  /** 使用的模型名称 */
  model: string;
  /** 数据集ID列表，限制检索范围 */
  datasetIds: string[];
  /** 重排序查询文本 */
  reRankQuery: string;
  /** 检索查询列表，支持多查询检索 */
  queries: string[];

  /** 相似度阈值，过滤低相似度结果 */
  [NodeInputKeyEnum.datasetSimilarity]?: number;
  /** 最大Token限制，控制返回内容长度 */
  [NodeInputKeyEnum.datasetMaxTokens]: number;
  /** 检索模式：向量检索、全文检索或混合检索 */
  [NodeInputKeyEnum.datasetSearchMode]?: `${DatasetSearchModeEnum}`;
  /** 向量检索权重，用于混合检索时的权重分配 */
  [NodeInputKeyEnum.datasetSearchEmbeddingWeight]?: number;

  /** 是否使用重排序 */
  [NodeInputKeyEnum.datasetSearchUsingReRank]?: boolean;
  /** 重排序模型配置 */
  [NodeInputKeyEnum.datasetSearchRerankModel]?: RerankModelItemType;
  /** 重排序权重 */
  [NodeInputKeyEnum.datasetSearchRerankWeight]?: number;

  /**
   * 集合过滤匹配条件（JSON字符串）
   * 
   * 支持的过滤条件：
   * {
   *   tags: {
   *     $and: ["tag1", "tag2"],     // 必须包含所有指定标签
   *     $or: ["tag1", "tag2", null] // 包含任一标签或无标签（null表示无标签）
   *   },
   *   createTime: {
   *     $gte: '2023-01-01',          // 创建时间大于等于
   *     $lte: '2023-12-31'           // 创建时间小于等于
   *   }
   * }
   */
  collectionFilterMatch?: string;
};

/**
 * 数据集检索响应类型定义
 * 
 * 包含检索结果和相关的统计信息。
 */
export type SearchDatasetDataResponse = {
  /** 检索结果列表 */
  searchRes: SearchDataResponseItemType[];
  /** 向量化消耗的Token数量 */
  embeddingTokens: number;
  /** 重排序消耗的Token数量 */
  reRankInputTokens: number;
  /** 实际使用的检索模式 */
  searchMode: `${DatasetSearchModeEnum}`;
  /** 结果数量限制 */
  limit: number;
  /** 相似度阈值 */
  similarity: number;
  /** 是否使用了重排序 */
  usingReRank: boolean;
  /** 是否使用了相似度过滤 */
  usingSimilarityFilter: boolean;

  /** 查询扩展结果（如果使用） */
  queryExtensionResult?: {
    /** 使用的模型 */
    model: string;
    /** 输入Token数量 */
    inputTokens: number;
    /** 输出Token数量 */
    outputTokens: number;
    /** 扩展后的查询 */
    query: string;
  };
  /** 深度搜索结果（如果使用） */
  deepSearchResult?: { 
    /** 使用的模型 */
    model: string; 
    /** 输入Token数量 */
    inputTokens: number; 
    /** 输出Token数量 */
    outputTokens: number; 
  };
};

/**
 * 数据集检索结果重排序
 * 
 * 使用专门的重排序模型对初步检索结果进行重新排序，以提高结果的相关性。
 * 重排序模型通常比embedding模型更精确，但计算成本也更高。
 * 
 * 工作流程：
 * 1. 将检索结果转换为重排序模型的输入格式
 * 2. 调用重排序模型计算相关性分数
 * 3. 根据新分数重新排序结果
 * 4. 更新结果的评分信息
 * 
 * @param params - 重排序参数
 * @param params.rerankModel - 重排序模型配置
 * @param params.data - 待重排序的检索结果
 * @param params.query - 查询文本
 * 
 * @returns Promise<{results: SearchDataResponseItemType[], inputTokens: number}> - 重排序后的结果和Token消耗
 * 
 * @throws 当重排序失败时抛出 'Rerank error'
 * 
 * @example
 * ```typescript
 * const rerankedResults = await datasetDataReRank({
 *   rerankModel: rerankModelConfig,
 *   data: searchResults,
 *   query: '用户查询文本'
 * });
 * 
 * console.log(`重排序后得到 ${rerankedResults.results.length} 个结果`);
 * console.log(`消耗 ${rerankedResults.inputTokens} 个Token`);
 * ```
 */
export const datasetDataReRank = async ({
  rerankModel,
  data,
  query
}: {
  rerankModel?: RerankModelItemType;
  data: SearchDataResponseItemType[];
  query: string;
}): Promise<{
  results: SearchDataResponseItemType[];
  inputTokens: number;
}> => {
  // 1. 调用重排序模型
  const { results, inputTokens } = await reRankRecall({
    model: rerankModel,
    query,
    // 将检索结果转换为重排序输入格式：合并问题和答案
    documents: data.map((item) => ({
      id: item.id,
      text: `${item.q}\n${item.a}` // 问答内容合并，用换行符分隔
    }))
  });

  // 2. 验证重排序结果
  if (results.length === 0) {
    return Promise.reject('Rerank error');
  }

  // 3. 合并重排序分数到原始数据
  const mergeResult = results
    .map((item, index) => {
      // 根据ID找到对应的原始数据
      const target = data.find((dataItem) => dataItem.id === item.id);
      if (!target) return null;
      
      const score = item.score || 0;

      // 更新评分信息：使用重排序分数
      return {
        ...target,
        score: [{ type: SearchScoreTypeEnum.reRank, value: score, index }]
      };
    })
    .filter(Boolean) as SearchDataResponseItemType[];

  return {
    results: mergeResult,
    inputTokens
  };
};
/**
 * 根据最大Token数量过滤检索结果
 * 
 * 为了控制上下文长度和API成本，需要限制检索结果的总Token数量。
 * 该函数会计算每个结果的Token数量，并按顺序累加，直到达到限制。
 * 
 * 处理策略：
 * 1. 计算每个结果的Token数量（问题+答案）
 * 2. 按顺序累加Token，直到超过限制
 * 3. 如果没有任何结果符合条件，至少返回第一个结果
 * 
 * @param data - 待过滤的检索结果
 * @param maxTokens - 最大Token数量限制
 * 
 * @returns Promise<SearchDataResponseItemType[]> - 过滤后的结果列表
 * 
 * @example
 * ```typescript
 * const filteredResults = await filterDatasetDataByMaxTokens(
 *   searchResults, 
 *   4000 // 限制为4000个Token
 * );
 * 
 * console.log(`过滤后保留 ${filteredResults.length} 个结果`);
 * ```
 */
export const filterDatasetDataByMaxTokens = async (
  data: SearchDataResponseItemType[],
  maxTokens: number
) => {
  const filterMaxTokensResult = await (async () => {
    // 1. 计算每个结果的Token数量
    const tokensScoreFilter = await Promise.all(
      data.map(async (item) => ({
        ...item,
        tokens: await countPromptTokens(item.q + item.a) // 计算问答内容的Token数
      }))
    );

    const results: SearchDataResponseItemType[] = [];
    let totalTokens = 0;

    // 2. 按顺序累加Token，直到超过限制
    for await (const item of tokensScoreFilter) {
      results.push(item);
      totalTokens += item.tokens;

      // 如果超过限制，停止添加
      if (totalTokens > maxTokens) {
        break;
      }
    }

    // 3. 确保至少返回一个结果（即使超过Token限制）
    return results.length === 0 ? data.slice(0, 1) : results;
  })();

  return filterMaxTokensResult;
};

/**
 * 数据集检索主函数
 * 
 * 这是数据集检索的核心函数，实现了完整的混合检索流程。
 * 支持多种检索模式、过滤条件和优化策略。
 * 
 * 主要流程：
 * 1. 参数初始化和验证
 * 2. 获取禁用集合列表
 * 3. 元数据过滤（标签、时间等）
 * 4. 执行向量检索和全文检索
 * 5. 结果融合（RRF算法）
 * 6. 重排序（可选）
 * 7. 相似度过滤
 * 8. Token限制过滤
 * 
 * 检索模式：
 * - embedding: 纯向量检索，适合语义相似度搜索
 * - fullTextRecall: 纯全文检索，适合关键词匹配
 * - mixedRecall: 混合检索，结合两种方式的优势
 * 
 * @param props - 检索参数，包含查询、过滤条件、模型配置等
 * 
 * @returns Promise<SearchDatasetDataResponse> - 检索结果和统计信息
 * 
 * @example
 * ```typescript
 * const searchResult = await searchDatasetData({
 *   teamId: 'team_123',
 *   datasetIds: ['dataset_456'],
 *   queries: ['用户问题'],
 *   reRankQuery: '用户问题',
 *   model: 'text-embedding-ada-002',
 *   datasetMaxTokens: 4000,
 *   datasetSearchMode: DatasetSearchModeEnum.mixedRecall,
 *   datasetSearchUsingReRank: true
 * });
 * 
 * console.log(`找到 ${searchResult.searchRes.length} 个相关结果`);
 * ```
 */
export async function searchDatasetData(
  props: SearchDatasetDataProps
): Promise<SearchDatasetDataResponse> {
  let {
    teamId,
    reRankQuery,
    queries,
    model,
    similarity = 0,
    limit: maxTokens,
    searchMode = DatasetSearchModeEnum.embedding,
    embeddingWeight = 0.5,
    usingReRank = false,
    rerankModel,
    rerankWeight = 0.5,
    datasetIds = [],
    collectionFilterMatch
  } = props;

  // 1. 常量定义：数据库查询字段
  const datasetDataSelectField =
    '_id datasetId collectionId updateTime q a imageId imageDescMap chunkIndex indexes';
  const datsaetCollectionSelectField =
    '_id name fileId rawLink apiFileId externalFileId externalFileUrl';

  // 2. 参数初始化和验证
  // 确保检索模式有效，默认使用向量检索
  searchMode = DatasetSearchModeMap[searchMode] ? searchMode : DatasetSearchModeEnum.embedding;
  // 只有在有可用的重排序模型时才启用重排序
  usingReRank = usingReRank && !!getDefaultRerankModel();

  // 3. 初始化状态变量
  let set = new Set<string>();           // 用于去重的集合
  let usingSimilarityFilter = false;     // 是否使用了相似度过滤

  // 4. 内部函数定义
  
  /**
   * 计算不同检索模式的召回限制
   * 
   * 根据检索模式动态调整向量检索和全文检索的数量限制，
   * 以平衡检索质量和性能。
   * 
   * @returns {embeddingLimit: number, fullTextLimit: number} - 检索限制配置
   */
  const countRecallLimit = () => {
    if (searchMode === DatasetSearchModeEnum.embedding) {
      // 纯向量检索：只使用向量检索，获取更多结果
      return {
        embeddingLimit: 100,
        fullTextLimit: 0
      };
    }
    if (searchMode === DatasetSearchModeEnum.fullTextRecall) {
      // 纯全文检索：只使用全文检索
      return {
        embeddingLimit: 0,
        fullTextLimit: 100
      };
    }
    // 混合检索：平衡两种检索方式，总数控制在合理范围内
    return {
      embeddingLimit: 80,  // 向量检索80个
      fullTextLimit: 60    // 全文检索60个
    };
  };
  /**
   * 获取禁用的集合数据
   * 
   * 查询被标记为禁用的集合，这些集合的数据不会参与检索。
   * 这是一个安全机制，用于临时或永久排除某些数据。
   * 
   * @returns Promise<{forbidCollectionIdList: string[]}> - 禁用集合ID列表
   */
  const getForbidData = async () => {
    const collections = await MongoDatasetCollection.find(
      {
        teamId,                           // 团队隔离
        datasetId: { $in: datasetIds },   // 限制在指定数据集内
        forbid: true                      // 只查询被禁用的集合
      },
      '_id'  // 只需要ID字段
    );

    return {
      forbidCollectionIdList: collections.map((item) => String(item._id))
    };
  };

  /**
   * 根据元数据过滤集合
   * 
   * 支持基于标签和创建时间的复杂过滤逻辑。
   * 这是一个高级过滤功能，允许用户精确控制检索范围。
   * 
   * 过滤规则：
   * 1. 标签过滤：
   *    - $and: 必须包含所有指定标签
   *    - $or: 包含任一标签或无标签（null）
   *    - $and 标签和 null 不能共存，否则返回空数组
   * 2. 时间过滤：支持创建时间范围过滤
   * 3. 递归处理：自动包含文件夹下的所有子集合
   * 
   * @returns Promise<string[] | undefined> - 符合条件的集合ID列表，undefined表示无过滤
   */
  const filterCollectionByMetadata = async (): Promise<string[] | undefined> => {
    const getAllCollectionIds = async ({
      parentCollectionIds
    }: {
      parentCollectionIds?: string[];
    }): Promise<string[] | undefined> => {
      if (!parentCollectionIds) return;
      if (parentCollectionIds.length === 0) {
        return [];
      }

      const collections = await MongoDatasetCollection.find(
        {
          teamId,
          datasetId: { $in: datasetIds },
          _id: { $in: parentCollectionIds }
        },
        '_id type',
        {
          ...readFromSecondary
        }
      ).lean();

      const resultIds = new Set<string>();
      collections.forEach((item) => {
        if (item.type !== 'folder') {
          resultIds.add(String(item._id));
        }
      });

      const folderIds = collections
        .filter((item) => item.type === 'folder')
        .map((item) => String(item._id));

      // Get all child collection ids
      if (folderIds.length) {
        const childCollections = await MongoDatasetCollection.find(
          {
            teamId,
            datasetId: { $in: datasetIds },
            parentId: { $in: folderIds }
          },
          '_id type',
          {
            ...readFromSecondary
          }
        ).lean();

        const childIds = await getAllCollectionIds({
          parentCollectionIds: childCollections.map((item) => String(item._id))
        });

        childIds?.forEach((id) => resultIds.add(id));
      }

      return Array.from(resultIds);
    };

    if (!collectionFilterMatch || !global.feConfigs.isPlus) return;

    let tagCollectionIdList: string[] | undefined = undefined;
    let createTimeCollectionIdList: string[] | undefined = undefined;

    try {
      const jsonMatch =
        typeof collectionFilterMatch === 'object'
          ? collectionFilterMatch
          : json5.parse(collectionFilterMatch);

      const andTags = jsonMatch?.tags?.$and as (string | null)[] | undefined;
      const orTags = jsonMatch?.tags?.$or as (string | null)[] | undefined;

      if (andTags && andTags.length > 0) {
        const uniqueAndTags = Array.from(new Set(andTags));
        if (uniqueAndTags.includes(null) && uniqueAndTags.some((tag) => typeof tag === 'string')) {
          return [];
        }
        if (uniqueAndTags.every((tag) => typeof tag === 'string')) {
          const matchedTags = await MongoDatasetCollectionTags.find(
            {
              teamId,
              datasetId: { $in: datasetIds },
              tag: { $in: uniqueAndTags as string[] }
            },
            '_id datasetId tag',
            { ...readFromSecondary }
          ).lean();

          // Group tags by dataset
          const datasetTagMap = new Map<string, { tagIds: string[]; tagNames: Set<string> }>();

          matchedTags.forEach((tag) => {
            const datasetId = String(tag.datasetId);
            if (!datasetTagMap.has(datasetId)) {
              datasetTagMap.set(datasetId, {
                tagIds: [],
                tagNames: new Set()
              });
            }

            const datasetData = datasetTagMap.get(datasetId)!;
            datasetData.tagIds.push(String(tag._id));
            datasetData.tagNames.add(tag.tag);
          });

          const validDatasetIds = Array.from(datasetTagMap.entries())
            .filter(([_, data]) => uniqueAndTags.every((tag) => data.tagNames.has(tag as string)))
            .map(([datasetId]) => datasetId);

          if (validDatasetIds.length === 0) return [];

          const collectionsPromises = validDatasetIds.map((datasetId) => {
            const { tagIds } = datasetTagMap.get(datasetId)!;
            return MongoDatasetCollection.find(
              {
                teamId,
                datasetId,
                tags: { $all: tagIds }
              },
              '_id',
              { ...readFromSecondary }
            ).lean();
          });

          const collectionsResults = await Promise.all(collectionsPromises);
          tagCollectionIdList = collectionsResults.flat().map((item) => String(item._id));
        } else if (uniqueAndTags.every((tag) => tag === null)) {
          const collections = await MongoDatasetCollection.find(
            {
              teamId,
              datasetId: { $in: datasetIds },
              $or: [{ tags: { $size: 0 } }, { tags: { $exists: false } }]
            },
            '_id',
            { ...readFromSecondary }
          ).lean();
          tagCollectionIdList = collections.map((item) => String(item._id));
        }
      } else if (orTags && orTags.length > 0) {
        // Get tagId by tag string
        const orTagArray = await MongoDatasetCollectionTags.find(
          {
            teamId,
            datasetId: { $in: datasetIds },
            tag: { $in: orTags.filter((tag) => tag !== null) }
          },
          '_id',
          { ...readFromSecondary }
        ).lean();
        const orTagIds = orTagArray.map((item) => String(item._id));

        // Get collections by tagId
        const collections = await MongoDatasetCollection.find(
          {
            teamId,
            datasetId: { $in: datasetIds },
            $or: [
              { tags: { $in: orTagIds } },
              ...(orTags.includes(null) ? [{ tags: { $size: 0 } }] : [])
            ]
          },
          '_id',
          { ...readFromSecondary }
        ).lean();

        tagCollectionIdList = collections.map((item) => String(item._id));
      }

      // time
      const getCreateTime = jsonMatch?.createTime?.$gte as string | undefined;
      const lteCreateTime = jsonMatch?.createTime?.$lte as string | undefined;
      if (getCreateTime || lteCreateTime) {
        const collections = await MongoDatasetCollection.find(
          {
            teamId,
            datasetId: { $in: datasetIds },
            createTime: {
              ...(getCreateTime && { $gte: new Date(getCreateTime) }),
              ...(lteCreateTime && {
                $lte: new Date(lteCreateTime)
              })
            }
          },
          '_id'
        );
        createTimeCollectionIdList = collections.map((item) => String(item._id));
      }

      // Concat tag and time
      const collectionIds = (() => {
        if (tagCollectionIdList && createTimeCollectionIdList) {
          return tagCollectionIdList.filter((id) =>
            (createTimeCollectionIdList as string[]).includes(id)
          );
        }

        return tagCollectionIdList || createTimeCollectionIdList;
      })();

      return await getAllCollectionIds({
        parentCollectionIds: collectionIds
      });
    } catch (error) {}
  };
  const embeddingRecall = async ({
    queries,
    limit,
    forbidCollectionIdList,
    filterCollectionIdList
  }: {
    queries: string[];
    limit: number;
    forbidCollectionIdList: string[];
    filterCollectionIdList?: string[];
  }): Promise<{
    embeddingRecallResults: SearchDataResponseItemType[][];
    tokens: number;
  }> => {
    if (limit === 0) {
      return {
        embeddingRecallResults: [],
        tokens: 0
      };
    }

    const { vectors, tokens } = await getVectorsByText({
      model: getEmbeddingModel(model),
      input: queries,
      type: 'query'
    });

    const recallResults = await Promise.all(
      vectors.map(async (vector) => {
        return await recallFromVectorStore({
          teamId,
          datasetIds,
          vector,
          limit,
          forbidCollectionIdList,
          filterCollectionIdList
        });
      })
    );

    // Get data and collections
    const collectionIdList = Array.from(
      new Set(recallResults.map((item) => item.results.map((item) => item.collectionId)).flat())
    );
    const indexDataIds = Array.from(
      new Set(recallResults.map((item) => item.results.map((item) => item.id?.trim())).flat())
    );

    const [dataMaps, collectionMaps] = await Promise.all([
      MongoDatasetData.find(
        {
          teamId,
          datasetId: { $in: datasetIds },
          collectionId: { $in: collectionIdList },
          'indexes.dataId': { $in: indexDataIds }
        },
        datasetDataSelectField,
        { ...readFromSecondary }
      )
        .lean()
        .then((res) => {
          const map = new Map<string, DatasetDataSchemaType>();

          res.forEach((item) => {
            item.indexes.forEach((index) => {
              map.set(String(index.dataId), item);
            });
          });

          return map;
        }),
      MongoDatasetCollection.find(
        {
          _id: { $in: collectionIdList }
        },
        datsaetCollectionSelectField,
        { ...readFromSecondary }
      )
        .lean()
        .then((res) => {
          const map = new Map<string, DatasetCollectionSchemaType>();

          res.forEach((item) => {
            map.set(String(item._id), item);
          });

          return map;
        })
    ]);

    const embeddingRecallResults = recallResults.map((item) => {
      const set = new Set<string>();
      return (
        item.results
          .map((item, index) => {
            const collection = collectionMaps.get(String(item.collectionId));
            if (!collection) {
              console.log('Collection is not found', item);
              return;
            }

            const data = dataMaps.get(String(item.id));
            if (!data) {
              console.log('Data is not found', item);
              return;
            }

            const result: SearchDataResponseItemType = {
              id: String(data._id),
              updateTime: data.updateTime,
              ...formatDatasetDataValue({
                teamId,
                datasetId: data.datasetId,
                q: data.q,
                a: data.a,
                imageId: data.imageId,
                imageDescMap: data.imageDescMap
              }),
              chunkIndex: data.chunkIndex,
              datasetId: String(data.datasetId),
              collectionId: String(data.collectionId),
              ...getCollectionSourceData(collection),
              score: [{ type: SearchScoreTypeEnum.embedding, value: item?.score || 0, index }]
            };

            return result;
          })
          // 多个向量对应一个数据，每一路召回，保障数据只有一份，并且取最高排名
          .filter((item) => {
            if (!item) return false;
            if (set.has(item.id)) return false;
            set.add(item.id);
            return true;
          })
          .map((item, index) => {
            return {
              ...item!,
              score: item!.score.map((item) => ({ ...item, index }))
            };
          }) as SearchDataResponseItemType[]
      );
    });

    return {
      embeddingRecallResults,
      tokens
    };
  };
  const fullTextRecall = async ({
    queries,
    limit,
    filterCollectionIdList,
    forbidCollectionIdList
  }: {
    queries: string[];
    limit: number;
    filterCollectionIdList?: string[];
    forbidCollectionIdList: string[];
  }): Promise<{
    fullTextRecallResults: SearchDataResponseItemType[][];
  }> => {
    if (limit === 0) {
      return {
        fullTextRecallResults: []
      };
    }

    const recallResults = await Promise.all(
      queries.map(async (query) => {
        return (await MongoDatasetDataText.aggregate(
          [
            {
              $match: {
                teamId: new Types.ObjectId(teamId),
                $text: { $search: await jiebaSplit({ text: query }) },
                datasetId: { $in: datasetIds.map((id) => new Types.ObjectId(id)) },
                ...(filterCollectionIdList
                  ? {
                      collectionId: {
                        $in: filterCollectionIdList
                          .filter((id) => !forbidCollectionIdList.includes(id))
                          .map((id) => new Types.ObjectId(id))
                      }
                    }
                  : forbidCollectionIdList?.length
                    ? {
                        collectionId: {
                          $nin: forbidCollectionIdList.map((id) => new Types.ObjectId(id))
                        }
                      }
                    : {})
              }
            },
            {
              $sort: {
                score: { $meta: 'textScore' }
              }
            },
            {
              $limit: limit
            },
            {
              $project: {
                _id: 1,
                collectionId: 1,
                dataId: 1,
                score: { $meta: 'textScore' }
              }
            }
          ],
          {
            ...readFromSecondary
          }
        )) as (DatasetDataTextSchemaType & { score: number })[];
      })
    );

    const dataIds = Array.from(
      new Set(recallResults.map((item) => item.map((item) => item.dataId)).flat())
    );
    const collectionIds = Array.from(
      new Set(recallResults.map((item) => item.map((item) => item.collectionId)).flat())
    );

    // Get data and collections
    const [dataMaps, collectionMaps] = await Promise.all([
      MongoDatasetData.find(
        {
          _id: { $in: dataIds }
        },
        datasetDataSelectField,
        { ...readFromSecondary }
      )
        .lean()
        .then((res) => {
          const map = new Map<string, DatasetDataSchemaType>();

          res.forEach((item) => {
            map.set(String(item._id), item);
          });

          return map;
        }),
      MongoDatasetCollection.find(
        {
          _id: { $in: collectionIds }
        },
        datsaetCollectionSelectField,
        { ...readFromSecondary }
      )
        .lean()
        .then((res) => {
          const map = new Map<string, DatasetCollectionSchemaType>();

          res.forEach((item) => {
            map.set(String(item._id), item);
          });

          return map;
        })
    ]);

    const fullTextRecallResults = recallResults.map((item) => {
      return item
        .map((item, index) => {
          const collection = collectionMaps.get(String(item.collectionId));
          if (!collection) {
            console.log('Collection is not found', item);
            return;
          }

          const data = dataMaps.get(String(item.dataId));
          if (!data) {
            console.log('Data is not found', item);
            return;
          }

          return {
            id: String(data._id),
            datasetId: String(data.datasetId),
            collectionId: String(data.collectionId),
            updateTime: data.updateTime,
            ...formatDatasetDataValue({
              teamId,
              datasetId: data.datasetId,
              q: data.q,
              a: data.a,
              imageId: data.imageId,
              imageDescMap: data.imageDescMap
            }),
            chunkIndex: data.chunkIndex,
            indexes: data.indexes,
            ...getCollectionSourceData(collection),
            score: [
              {
                type: SearchScoreTypeEnum.fullText,
                value: item.score || 0,
                index
              }
            ]
          };
        })
        .filter((item) => {
          if (!item) return false;
          return true;
        })
        .map((item, index) => {
          return {
            ...item,
            score: item!.score.map((item) => ({ ...item, index }))
          };
        }) as SearchDataResponseItemType[];
    });

    return {
      fullTextRecallResults
    };
  };
  const multiQueryRecall = async ({
    embeddingLimit,
    fullTextLimit
  }: {
    embeddingLimit: number;
    fullTextLimit: number;
  }) => {
    const [{ forbidCollectionIdList }, filterCollectionIdList] = await Promise.all([
      getForbidData(),
      filterCollectionByMetadata()
    ]);

    const [{ tokens, embeddingRecallResults }, { fullTextRecallResults }] = await Promise.all([
      embeddingRecall({
        queries,
        limit: embeddingLimit,
        forbidCollectionIdList,
        filterCollectionIdList
      }),
      fullTextRecall({
        queries,
        limit: fullTextLimit,
        filterCollectionIdList,
        forbidCollectionIdList
      })
    ]);

    // rrf concat
    const rrfEmbRecall = datasetSearchResultConcat(
      embeddingRecallResults.map((list) => ({ k: 60, list }))
    ).slice(0, embeddingLimit);
    const rrfFTRecall = datasetSearchResultConcat(
      fullTextRecallResults.map((list) => ({ k: 60, list }))
    ).slice(0, fullTextLimit);

    return {
      tokens,
      embeddingRecallResults: rrfEmbRecall,
      fullTextRecallResults: rrfFTRecall
    };
  };

  /* main step */
  // count limit
  const { embeddingLimit, fullTextLimit } = countRecallLimit();

  // recall
  const {
    embeddingRecallResults,
    fullTextRecallResults,
    tokens: embeddingTokens
  } = await multiQueryRecall({
    embeddingLimit,
    fullTextLimit
  });

  // ReRank results
  const { results: reRankResults, inputTokens: reRankInputTokens } = await (async () => {
    if (!usingReRank) {
      return {
        results: [],
        inputTokens: 0
      };
    }

    set = new Set<string>(embeddingRecallResults.map((item) => item.id));
    const concatRecallResults = embeddingRecallResults.concat(
      fullTextRecallResults.filter((item) => !set.has(item.id))
    );

    // remove same q and a data
    set = new Set<string>();
    const filterSameDataResults = concatRecallResults.filter((item) => {
      // 删除所有的标点符号与空格等，只对文本进行比较
      const str = hashStr(`${item.q}${item.a}`.replace(/[^\p{L}\p{N}]/gu, ''));
      if (set.has(str)) return false;
      set.add(str);
      return true;
    });
    try {
      return await datasetDataReRank({
        rerankModel,
        query: reRankQuery,
        data: filterSameDataResults
      });
    } catch (error) {
      usingReRank = false;
      return {
        results: [],
        inputTokens: 0
      };
    }
  })();

  // embedding recall and fullText recall rrf concat
  const baseK = 120;
  const embK = Math.round(baseK * (1 - embeddingWeight)); // 搜索结果的 k 值
  const fullTextK = Math.round(baseK * embeddingWeight); // rerank 结果的 k 值

  const rrfSearchResult = datasetSearchResultConcat([
    { k: embK, list: embeddingRecallResults },
    { k: fullTextK, list: fullTextRecallResults }
  ]);
  const rrfConcatResults = (() => {
    if (reRankResults.length === 0) return rrfSearchResult;
    if (rerankWeight === 1) return reRankResults;

    const searchK = Math.round(baseK * rerankWeight); // 搜索结果的 k 值
    const rerankK = Math.round(baseK * (1 - rerankWeight)); // rerank 结果的 k 值

    return datasetSearchResultConcat([
      { k: searchK, list: rrfSearchResult },
      { k: rerankK, list: reRankResults }
    ]);
  })();

  // remove same q and a data
  set = new Set<string>();
  const filterSameDataResults = rrfConcatResults.filter((item) => {
    // 删除所有的标点符号与空格等，只对文本进行比较
    const str = hashStr(`${item.q}${item.a}`.replace(/[^\p{L}\p{N}]/gu, ''));
    if (set.has(str)) return false;
    set.add(str);
    return true;
  });

  // score filter
  const scoreFilter = (() => {
    if (usingReRank) {
      usingSimilarityFilter = true;

      return filterSameDataResults.filter((item) => {
        const reRankScore = item.score.find((item) => item.type === SearchScoreTypeEnum.reRank);
        if (reRankScore && reRankScore.value < similarity) return false;
        return true;
      });
    }
    if (searchMode === DatasetSearchModeEnum.embedding) {
      usingSimilarityFilter = true;
      return filterSameDataResults.filter((item) => {
        const embeddingScore = item.score.find(
          (item) => item.type === SearchScoreTypeEnum.embedding
        );
        if (embeddingScore && embeddingScore.value < similarity) return false;
        return true;
      });
    }
    return filterSameDataResults;
  })();

  // token filter
  const filterMaxTokensResult = await filterDatasetDataByMaxTokens(scoreFilter, maxTokens);

  return {
    searchRes: filterMaxTokensResult,
    embeddingTokens,
    reRankInputTokens,
    searchMode,
    limit: maxTokens,
    similarity,
    usingReRank,
    usingSimilarityFilter
  };
}

export type DefaultSearchDatasetDataProps = SearchDatasetDataProps & {
  [NodeInputKeyEnum.datasetSearchUsingExtensionQuery]?: boolean;
  [NodeInputKeyEnum.datasetSearchExtensionModel]?: string;
  [NodeInputKeyEnum.datasetSearchExtensionBg]?: string;
};
export const defaultSearchDatasetData = async ({
  datasetSearchUsingExtensionQuery,
  datasetSearchExtensionModel,
  datasetSearchExtensionBg,
  ...props
}: DefaultSearchDatasetDataProps): Promise<SearchDatasetDataResponse> => {
  const query = props.queries[0];
  const histories = props.histories;

  const extensionModel = datasetSearchUsingExtensionQuery
    ? getLLMModel(datasetSearchExtensionModel)
    : undefined;

  const { concatQueries, extensionQueries, rewriteQuery, aiExtensionResult } =
    await datasetSearchQueryExtension({
      query,
      extensionModel,
      extensionBg: datasetSearchExtensionBg,
      histories
    });

  const result = await searchDatasetData({
    ...props,
    reRankQuery: rewriteQuery,
    queries: concatQueries
  });

  return {
    ...result,
    queryExtensionResult: aiExtensionResult
      ? {
          model: aiExtensionResult.model,
          inputTokens: aiExtensionResult.inputTokens,
          outputTokens: aiExtensionResult.outputTokens,
          query: extensionQueries.join('\n')
        }
      : undefined
  };
};

export type DeepRagSearchProps = SearchDatasetDataProps & {
  [NodeInputKeyEnum.datasetDeepSearchModel]?: string;
  [NodeInputKeyEnum.datasetDeepSearchMaxTimes]?: number;
  [NodeInputKeyEnum.datasetDeepSearchBg]?: string;
};
export const deepRagSearch = (data: DeepRagSearchProps) => global.deepRagHandler(data);
