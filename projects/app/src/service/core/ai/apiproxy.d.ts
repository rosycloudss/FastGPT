/**
 * API代理服务相关的TypeScript类型定义
 * 定义了API代理服务中使用的各种数据结构和接口
 */

/**
 * 创建模型的参数类型定义
 * 用于定义创建新AI模型时需要提供的参数结构
 * 
 * @interface CreateModelParams
 */
export type CreateModelParams = {
  /** 模型名称，用于标识和引用模型 */
  name: string;
  /** 模型描述，说明模型的用途和特性 */
  description: string;
  /** 模型提示词，定义模型的行为和响应方式 */
  prompt: string;
};
