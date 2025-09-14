/**
 * 聊天服务工具函数
 * 提供聊天相关的数据处理和时间过滤功能
 */

import type { DatasetCiteItemType } from '@fastgpt/global/core/dataset/type';

/**
 * 处理聊天时间过滤的引用内容
 * 根据指定的聊天时间，从数据集引用项中获取该时间点的历史版本内容
 * 主要用于时间旅行功能，允许用户查看特定时间点的对话内容
 * 
 * @param dataList - 数据集引用项列表，包含问答内容和历史记录
 * @param chatTime - 目标聊天时间，用于筛选历史版本
 * @returns DatasetCiteItemType[] - 处理后的引用项列表，包含指定时间点的内容
 */
export function processChatTimeFilter(
  dataList: DatasetCiteItemType[],
  chatTime: Date
): DatasetCiteItemType[] {
  return dataList.map((item) => {
    // 保存原始数据项作为默认返回值
    const defaultItem = item;

    // 如果数据项没有历史记录，直接返回原始数据
    if (!item.history) return defaultItem;

    // 获取历史记录数组
    const history = item.history;
    // 格式化目标聊天时间
    const formatedChatTime = new Date(chatTime);

    // 如果数据项的更新时间早于或等于目标时间，说明当前版本就是目标时间的版本
    if (item.updateTime <= formatedChatTime) {
      return defaultItem;
    }

    // 在历史记录中查找最接近目标时间且不晚于目标时间的版本
    const latestHistoryIndex = history.findIndex(
      (historyItem) => historyItem.updateTime <= formatedChatTime
    );

    // 如果没有找到符合条件的历史版本，返回原始数据
    if (latestHistoryIndex === -1) {
      return defaultItem;
    }

    // 获取找到的历史版本
    const latestHistory = history[latestHistoryIndex];

    // 返回使用历史版本内容的数据项
    return {
      ...item, // 保留原始数据的其他属性
      q: latestHistory.q, // 使用历史版本的问题内容
      a: latestHistory.a, // 使用历史版本的答案内容
      updateTime: latestHistory.updateTime, // 使用历史版本的更新时间
      updated: true // 标记为已更新，表示使用了历史版本
    };
  });
}
