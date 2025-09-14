/**
 * 数据集数据控制器模块
 * 负责数据集数据的创建、更新、删除等核心操作
 * 包含向量索引管理、文本分块、数据库事务处理等功能
 */

// MongoDB 数据模型
import { MongoDatasetData } from '@fastgpt/service/core/dataset/data/schema';

// 类型定义
import {
  type CreateDatasetDataProps,
  type PatchIndexesProps,
  type UpdateDatasetDataProps
} from '@fastgpt/global/core/dataset/controller';
import {
  type DatasetDataIndexItemType,
  type DatasetDataItemType
} from '@fastgpt/global/core/dataset/type';
import { type ClientSession } from '@fastgpt/service/common/mongo';

// 向量数据库操作
import { insertDatasetDataVector } from '@fastgpt/service/common/vectorDB/controller';
import { deleteDatasetDataVector } from '@fastgpt/service/common/vectorDB/controller';

// 文本处理工具
import { jiebaSplit } from '@fastgpt/service/common/string/jieba/index';
import { countPromptTokens } from '@fastgpt/service/common/string/tiktoken';
import { text2Chunks } from '@fastgpt/service/worker/function';

// AI 模型相关
import { getEmbeddingModel } from '@fastgpt/service/core/ai/model';

// 数据库操作
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { MongoDatasetDataText } from '@fastgpt/service/core/dataset/data/dataTextSchema';

// 常量定义
import { DatasetDataIndexTypeEnum } from '@fastgpt/global/core/dataset/data/constants';

// 图片处理
import { deleteDatasetImage } from '@fastgpt/service/core/dataset/image/controller';

/**
 * 格式化索引数据
 * 将原始索引数据转换为标准格式，包含文本分块和token计算
 * @param indexes - 原始索引数组
 * @param q - 问题文本
 * @param a - 答案文本
 * @param indexSize - 索引块大小
 * @param maxIndexSize - 最大索引大小
 * @param indexPrefix - 索引前缀
 * @returns 格式化后的索引数组
 */
const formatIndexes = async ({
  indexes = [],
  q,
  a = '',
  indexSize,
  maxIndexSize,
  indexPrefix
}: {
  indexes?: (Omit<DatasetDataIndexItemType, 'dataId'> & { dataId?: string })[];
  q: string;
  a?: string;
  indexSize: number;
  maxIndexSize: number;
  indexPrefix?: string;
}): Promise<
  {
    type: `${DatasetDataIndexTypeEnum}`;
    text: string;
    dataId?: string;
  }[]
> => {
  const formatText = (text: string) => {
    if (indexPrefix && !text.startsWith(indexPrefix)) {
      return `${indexPrefix}\n${text}`;
    }
    return text;
  };
  /* get dataset data default index */
  const getDefaultIndex = async ({
    q = '',
    a,
    indexSize
  }: {
    q?: string;
    a?: string;
    indexSize: number;
  }) => {
    const qChunks = (
      await text2Chunks({
        text: q,
        chunkSize: indexSize,
        maxSize: maxIndexSize
      })
    ).chunks;
    const aChunks = a
      ? (await text2Chunks({ text: a, chunkSize: indexSize, maxSize: maxIndexSize })).chunks
      : [];

    return [
      ...qChunks.map((text) => ({
        text: formatText(text),
        type: DatasetDataIndexTypeEnum.default
      })),
      ...aChunks.map((text) => ({
        text: formatText(text),
        type: DatasetDataIndexTypeEnum.default
      }))
    ];
  };

  // If index not type, set it to custom
  indexes = indexes.map((item) => ({
    text: typeof item.text === 'string' ? item.text : String(item.text),
    type: item.type || DatasetDataIndexTypeEnum.custom,
    dataId: item.dataId
  }));

  // Recompute default indexes, Merge ids of the same index, reduce the number of rebuilds
  const defaultIndexes = await getDefaultIndex({ q, a, indexSize });

  const concatDefaultIndexes = defaultIndexes.map((item) => {
    const oldIndex = indexes!.find((index) => index.text === item.text);
    if (oldIndex) {
      return {
        type: DatasetDataIndexTypeEnum.default,
        text: item.text,
        dataId: oldIndex.dataId
      };
    } else {
      return item;
    }
  });

  // 其他索引不能与默认索引相同，且不能自己有重复
  indexes = indexes.filter(
    (item, index, self) =>
      item.type !== DatasetDataIndexTypeEnum.default &&
      !concatDefaultIndexes.find((t) => t.text === item.text) &&
      index === self.findIndex((t) => t.text === item.text)
  );
  indexes.push(...concatDefaultIndexes);

  const chekcIndexes = (
    await Promise.all(
      indexes.map(async (item) => {
        if (item.type === DatasetDataIndexTypeEnum.default) {
          return item;
        }

        // If oversize tokens, split it
        const tokens = await countPromptTokens(item.text);
        if (tokens > maxIndexSize) {
          const splitText = (
            await text2Chunks({
              text: item.text,
              chunkSize: indexSize,
              maxSize: maxIndexSize
            })
          ).chunks;
          return splitText.map((text) => ({
            text,
            type: item.type
          }));
        }

        return item;
      })
    )
  )
    .flat()
    .filter((item) => !!item.text.trim());

  // Add prefix
  const prefixIndexes = indexPrefix
    ? chekcIndexes.map((index) => {
        if (index.type === DatasetDataIndexTypeEnum.custom) return index;
        return {
          ...index,
          text: formatText(index.text)
        };
      })
    : chekcIndexes;

  return prefixIndexes;
};
/* insert data.
 * 1. create data id
 * 2. insert pg
 * 3. create mongo data
 */
/**
 * 向数据集插入新数据
 * 包含向量索引创建、MongoDB数据存储、全文索引等完整流程
 * @param teamId - 团队ID
 * @param tmbId - 团队成员ID
 * @param datasetId - 数据集ID
 * @param collectionId - 集合ID
 * @param q - 问题文本
 * @param a - 答案文本
 * @param imageId - 图片ID（可选）
 * @param chunkIndex - 分块索引
 * @param indexSize - 索引大小
 * @param indexes - 索引数组
 * @param indexPrefix - 索引前缀
 * @param embeddingModel - 嵌入模型名称
 * @param imageDescMap - 图片描述映射
 * @param session - 数据库会话
 * @returns 插入结果，包含ID和token消耗
 */
export async function insertData2Dataset({
  teamId,
  tmbId,
  datasetId,
  collectionId,
  q,
  a,
  imageId,
  chunkIndex = 0,
  indexSize = 512,
  indexes,
  indexPrefix,
  embeddingModel,
  imageDescMap,
  session
}: CreateDatasetDataProps & {
  embeddingModel: string;
  indexSize?: number;
  imageDescMap?: Record<string, string>;
  session?: ClientSession;
}) {
  if (!q || !datasetId || !collectionId || !embeddingModel) {
    return Promise.reject('q, datasetId, collectionId, embeddingModel is required');
  }
  if (String(teamId) === String(tmbId)) {
    return Promise.reject("teamId and tmbId can't be the same");
  }

  const embModel = getEmbeddingModel(embeddingModel);
  indexSize = Math.min(embModel.maxToken, indexSize);

  // 1. Get vector indexes and insert
  // Empty indexes check, if empty, create default index
  const newIndexes = await formatIndexes({
    indexes,
    q,
    a,
    indexSize,
    maxIndexSize: embModel.maxToken,
    indexPrefix
  });

  // insert to vector store
  const { tokens, insertIds } = await insertDatasetDataVector({
    inputs: newIndexes.map((item) => item.text),
    model: embModel,
    teamId,
    datasetId,
    collectionId
  });
  const results = newIndexes.map((item, index) => ({
    ...item,
    dataId: insertIds[index]
  }));

  // 2. Create mongo data
  const [{ _id }] = await MongoDatasetData.create(
    [
      {
        teamId,
        tmbId,
        datasetId,
        collectionId,
        q,
        a,
        imageId,
        imageDescMap,
        chunkIndex,
        indexes: results
      }
    ],
    { session, ordered: true }
  );

  // 3. Create mongo data text
  await MongoDatasetDataText.create(
    [
      {
        teamId,
        datasetId,
        collectionId,
        dataId: _id,
        fullTextToken: await jiebaSplit({ text: `${q}\n${a}`.trim() })
      }
    ],
    { session, ordered: true }
  );

  return {
    insertId: _id,
    tokens
  };
}

/**
 * 更新数据集数据（索引覆盖模式）
 * 执行流程：
 * 1. 比较新旧索引差异
 * 2. 插入新的向量数据
 * 3. 在事务中更新MongoDB数据
 * 4. 删除旧的向量数据
 * @param dataId - 数据ID
 * @param q - 问题文本
 * @param a - 答案文本
 * @param indexes - 新的索引数组
 * @param model - 嵌入模型名称
 * @param indexSize - 索引大小
 * @param indexPrefix - 索引前缀
 * @returns 更新结果，包含token消耗
 */
export async function updateData2Dataset({
  dataId,
  q = '',
  a,
  indexes,
  model,
  indexSize = 512,
  indexPrefix
}: UpdateDatasetDataProps & { model: string; indexSize?: number }) {
  if (!Array.isArray(indexes)) {
    return Promise.reject('indexes is required');
  }

  // 1. Get mongo data
  const mongoData = await MongoDatasetData.findById(dataId);
  if (!mongoData) return Promise.reject('core.dataset.error.Data not found');

  // 2. Compute indexes
  const formatIndexesResult = await formatIndexes({
    indexes,
    q,
    a,
    indexSize,
    maxIndexSize: getEmbeddingModel(model).maxToken,
    indexPrefix
  });

  // 3. Patch indexes, create, update, delete
  const patchResult: PatchIndexesProps[] = [];
  // find database indexes in new Indexes, if have not,  delete it
  for (const item of mongoData.indexes) {
    const index = formatIndexesResult.find((index) => index.dataId === item.dataId);
    if (!index) {
      patchResult.push({
        type: 'delete',
        index: item
      });
    }
  }
  for (const item of formatIndexesResult) {
    if (!item.dataId) {
      patchResult.push({
        type: 'create',
        index: item
      });
    } else {
      const index = mongoData.indexes.find((index) => index.dataId === item.dataId);
      if (!index) continue;

      // Not change
      if (index.text === item.text) {
        patchResult.push({
          type: 'unChange',
          index: {
            ...item,
            dataId: index.dataId
          }
        });
      } else {
        // index Update
        patchResult.push({
          type: 'update',
          index: {
            ...item,
            dataId: index.dataId
          }
        });
      }
    }
  }

  const deleteVectorIdList = patchResult
    .filter((item) => item.type === 'delete' || item.type === 'update')
    .map((item) => item.index.dataId)
    .filter(Boolean) as string[];

  // 4. Update mongo updateTime(便于脏数据检查器识别)
  const updateTime = mongoData.updateTime;
  mongoData.updateTime = new Date();
  await mongoData.save();

  // 5. insert vector

  const insertItems = patchResult.filter(
    (item) => item.type === 'create' || item.type === 'update'
  );
  const tokens = await (async () => {
    if (insertItems.length > 0) {
      // Batch insert vectors
      const result = await insertDatasetDataVector({
        inputs: insertItems.map((item) => item.index.text),
        model: getEmbeddingModel(model),
        teamId: mongoData.teamId,
        datasetId: mongoData.datasetId,
        collectionId: mongoData.collectionId
      });

      // Update dataIds for the items
      insertItems.forEach((item, index) => {
        item.index.dataId = result.insertIds[index];
      });

      return result.tokens;
    }
    return 0;
  })();

  const newIndexes = patchResult
    .filter((item) => item.type !== 'delete')
    .map((item) => item.index) as DatasetDataIndexItemType[];

  // 6. update mongo data
  await mongoSessionRun(async (session) => {
    // Update history
    mongoData.history =
      q !== mongoData.q || a !== mongoData.a
        ? [
            {
              q: mongoData.q,
              a: mongoData.a,
              updateTime: updateTime
            },
            ...(mongoData.history?.slice(0, 9) || [])
          ]
        : mongoData.history;
    mongoData.q = q || mongoData.q;
    mongoData.a = a ?? mongoData.a;
    mongoData.indexes = newIndexes;
    await mongoData.save({ session });

    // update mongo data text
    await MongoDatasetDataText.updateOne(
      { dataId: mongoData._id },
      { fullTextToken: await jiebaSplit({ text: `${mongoData.q}\n${mongoData.a}`.trim() }) },
      { session }
    );

    // Delete vector
    if (deleteVectorIdList.length > 0) {
      await deleteDatasetDataVector({
        teamId: mongoData.teamId,
        idList: deleteVectorIdList
      });
    }
  });

  return {
    tokens
  };
}

/**
 * 删除数据集数据
 * 完整删除流程：MongoDB数据、图片文件、向量数据
 * @param data - 要删除的数据项
 */
export const deleteDatasetData = async (data: DatasetDataItemType) => {
  await mongoSessionRun(async (session) => {
    // 1. Delete MongoDB data
    await MongoDatasetData.deleteOne({ _id: data.id }, { session });
    await MongoDatasetDataText.deleteMany({ dataId: data.id }, { session });

    // 2. If there are any image files, delete the image records and GridFS file.
    if (data.imageId) {
      await deleteDatasetImage(data.imageId);
    }

    // 3. Delete vector data
    await deleteDatasetDataVector({
      teamId: data.teamId,
      idList: data.indexes.map((item) => item.dataId)
    });
  });
};
