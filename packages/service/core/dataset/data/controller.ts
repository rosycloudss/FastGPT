// 导入图片URL处理工具函数
import { addEndpointToImageUrl } from '../../../common/file/image/utils';
// 导入数据集图片预览URL生成工具
import { getDatasetImagePreviewUrl } from '../image/utils';
// 导入数据集相关的TypeScript类型定义
import type { DatasetCiteItemType, DatasetDataSchemaType } from '@fastgpt/global/core/dataset/type';

/**
 * 格式化数据集数据值
 * 主要功能：
 * 1. 为图片markdown添加描述信息
 * 2. 为图片URL添加端点前缀
 * 3. 生成图片预览URL
 * 
 * @param params 参数对象
 * @param params.teamId 团队ID
 * @param params.datasetId 数据集ID
 * @param params.q 问题内容
 * @param params.a 答案内容（可选）
 * @param params.imageId 图片ID（可选）
 * @param params.imageDescMap 图片描述映射表（可选）
 * @returns 格式化后的数据对象
 */
export const formatDatasetDataValue = ({
  teamId,
  datasetId,
  q,
  a,
  imageId,
  imageDescMap
}: {
  teamId: string;
  datasetId: string;
  q: string;
  a?: string;
  imageId?: string;
  imageDescMap?: Record<string, string>;
}): {
  q: string;
  a?: string;
  imagePreivewUrl?: string;
} => {
  // 如果存在图片描述映射表，则为图片markdown添加描述信息
  if (imageDescMap) {
    /**
     * 辅助函数：替换图片markdown中的描述信息
     * 使用正则表达式匹配markdown格式的图片：![alt](url)
     * 如果找到对应的描述，则将描述添加到alt文本中
     * 
     * @param text 需要处理的文本
     * @returns 处理后的文本
     */
    const replaceImageMarkdown = (text: string): string => {
      return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, altText, url) => {
        const description = imageDescMap[url];
        if (description) {
          // 将描述添加到alt文本中，如果原有alt文本存在则保留
          const newAltText = altText ? `${altText} - ${description}` : description;
          // 移除换行符以保持markdown格式的完整性
          return `![${newAltText.replace(/\n/g, '')}](${url})`;
        }
        return match; // 如果没有找到描述，返回原始匹配内容
      });
    };

    // 对问题和答案内容都应用图片描述替换
    q = replaceImageMarkdown(q);
    if (a) {
      a = replaceImageMarkdown(a);
    }
  }

  // 为图片URL添加端点基础URL，确保图片可以正确访问
  q = addEndpointToImageUrl(q);
  if (a) {
    a = addEndpointToImageUrl(a);
  }

  // 如果没有图片ID，直接返回处理后的问题和答案
  if (!imageId) {
    return {
      q,
      a
    };
  }

  // 生成图片预览URL，设置7天的过期时间
  const previewUrl = getDatasetImagePreviewUrl({
    imageId,
    teamId,
    datasetId,
    expiredMinutes: 60 * 24 * 7 // 7天过期时间（分钟）
  });

  // 返回格式化后的数据，将问题内容转换为图片markdown格式
  return {
    q: `![${q.replaceAll('\n', '')}](${previewUrl})`, // 将问题转换为图片格式，移除换行符
    a, // 答案内容保持不变
    imagePreivewUrl: previewUrl // 图片预览URL
  };
};

/**
 * 获取格式化的数据集引用列表
 * 将原始数据集数据转换为引用格式，包含格式化的问答内容和元数据
 * 
 * @param list 原始数据集数据列表
 * @returns 格式化后的数据集引用列表
 */
export const getFormatDatasetCiteList = (list: DatasetDataSchemaType[]) => {
  return list.map<DatasetCiteItemType>((item) => ({
    _id: item._id, // 数据项唯一标识
    // 使用formatDatasetDataValue函数格式化问答内容
    ...formatDatasetDataValue({
      teamId: item.teamId,
      datasetId: item.datasetId,
      q: item.q,
      a: item.a,
      imageId: item.imageId
    }),
    history: item.history, // 历史记录
    updateTime: item.updateTime, // 更新时间
    index: item.chunkIndex // 数据块索引
  }));
};
