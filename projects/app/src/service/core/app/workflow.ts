/**
 * 应用工作流相关工具函数
 * 提供工作流节点分析、模型提取等功能
 */

import { NodeInputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import type { StoreNodeItemType } from '@fastgpt/global/core/workflow/type/node.d';
import { getLLMModel } from '@fastgpt/service/core/ai/model';

/**
 * 从工作流节点中提取所有使用的聊天模型名称列表
 * 遍历所有节点，查找配置了AI模型的节点，并提取模型名称
 * 主要用于统计应用使用了哪些AI模型，便于资源管理和计费
 * 
 * @param nodes - 工作流节点数组，包含所有节点的配置信息
 * @returns string[] - 去重后的模型名称列表
 */
export const getChatModelNameListByModules = (nodes: StoreNodeItemType[]): string[] => {
  // 遍历所有节点，提取AI模型配置
  const modelList = nodes
    .map((item) => {
      // 在节点的输入配置中查找AI模型参数
      const model = item.inputs.find((input) => input.key === NodeInputKeyEnum.aiModel)?.value;
      // 如果找到模型配置，获取模型的显示名称；否则返回空字符串
      return model ? getLLMModel(model)?.name : '';
    })
    .filter(Boolean); // 过滤掉空字符串，只保留有效的模型名称

  // 使用Set去重，然后转换为数组返回
  return Array.from(new Set(modelList));
};
