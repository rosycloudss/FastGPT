/**
 * 数据集数据工具模块
 * 提供数据验证、重复检查等辅助功能
 */

// MongoDB 数据模型
import { MongoDatasetData } from '@fastgpt/service/core/dataset/data/schema';

/**
 * 检查是否存在相同的数据
 * 用于防止在同一集合中插入重复的问答对
 * @param teamId - 团队ID
 * @param datasetId - 数据集ID
 * @param collectionId - 集合ID
 * @param q - 问题文本
 * @param a - 答案文本（可选）
 * @throws 如果存在相同数据则抛出异常
 */
export async function hasSameValue({
  teamId,
  datasetId,
  collectionId,
  q,
  a = ''
}: {
  teamId: string;
  datasetId: string;
  collectionId: string;
  q: string;
  a?: string;
}) {
  // 查询数据库中是否存在完全相同的问答对
  const count = await MongoDatasetData.countDocuments({
    teamId,
    datasetId,
    collectionId,
    q,
    a
  });

  // 如果存在重复数据，抛出异常
  if (count > 0) {
    return Promise.reject('已经存在完全一致的数据');
  }
}
