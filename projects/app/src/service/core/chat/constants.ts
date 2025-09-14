/**
 * 聊天服务相关常量定义
 * 定义聊天功能中使用的各种常量和配置
 */

import { type DatasetDataSchemaType } from '@fastgpt/global/core/dataset/type';

/**
 * 引用数据字段选择器
 * 定义从数据库查询引用数据时需要选择的字段列表
 * 用于优化数据库查询性能，只获取必要的字段
 * 
 * 包含的字段说明：
 * - _id: 数据唯一标识符
 * - teamId: 团队ID，用于数据隔离
 * - datasetId: 数据集ID，标识数据来源
 * - q: 问题内容
 * - a: 答案内容
 * - imageId: 关联的图片ID（如果有）
 * - history: 历史记录
 * - updateTime: 更新时间
 * - chunkIndex: 数据块索引
 */
export const quoteDataFieldSelector =
  '_id teamId datasetId q a imageId history updateTime chunkIndex';
