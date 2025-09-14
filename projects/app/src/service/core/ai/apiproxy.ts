/**
 * API代理服务模块
 * 提供统一的API代理功能，用于转发和处理外部API请求
 * 支持请求拦截、响应处理、错误处理等功能
 */

import { addLog } from '@fastgpt/service/common/system/log';
import axios, { type Method } from 'axios';

// 从环境变量获取API代理服务的URL
const url = process.env.API_PROXY_URL;
// 从环境变量获取API代理服务的认证令牌
const token = process.env.API_PROXY_TOKEN;

/**
 * 创建axios实例，配置基础请求参数
 * - baseURL: API代理服务的基础URL
 * - timeout: 请求超时时间设置为60秒
 * - headers: 设置Bearer认证头
 */
const instance = axios.create({
  baseURL: url,
  timeout: 60000, // 超时时间设置为60秒，适合处理较长时间的AI模型请求
  headers: {
    Authorization: `Bearer ${token}` // 使用Bearer令牌进行身份认证
  }
});

/**
 * 响应数据检查和处理函数
 * 验证API响应数据的有效性，确保返回正确的数据格式
 * 
 * @param data - API响应的原始数据
 * @returns 处理后的响应数据
 * @throws 当数据为undefined时抛出服务器异常错误
 */
const checkRes = (data: any) => {
  // 检查响应数据是否为空或未定义
  if (data === undefined) {
    // 记录空数据日志，便于问题排查
    addLog.info('api proxy data is empty');
    return Promise.reject('服务器异常');
  }
  // 返回响应数据中的实际内容部分
  return data.data;
};
/**
 * 统一的错误处理函数
 * 处理各种类型的请求错误，标准化错误格式并返回给调用方
 * 
 * @param err - 捕获到的错误对象，可能是各种不同的格式
 * @returns 标准化后的错误Promise
 */
const responseError = (err: any) => {
  // 记录错误信息到控制台，便于开发调试
  console.log('error->', '请求错误', err);

  // 处理空错误的情况
  if (!err) {
    return Promise.reject({ message: '未知错误' });
  }
  
  // 处理字符串类型的错误
  if (typeof err === 'string') {
    return Promise.reject({ message: err });
  }
  
  // 处理包含message属性的错误对象
  if (typeof err.message === 'string') {
    return Promise.reject({ message: err.message });
  }
  
  // 处理包含data属性的错误对象
  if (typeof err.data === 'string') {
    return Promise.reject({ message: err.data });
  }
  
  // 处理HTTP响应错误，优先使用响应体中的错误信息
  if (err?.response?.data) {
    return Promise.reject(err?.response?.data);
  }
  
  // 默认情况下直接返回原始错误
  return Promise.reject(err);
};

/**
 * 通用的HTTP请求函数
 * 支持GET、POST、PUT、DELETE等HTTP方法，自动处理请求参数和响应数据
 * 
 * @template T - 响应数据的类型
 * @param url - 请求的URL路径
 * @param data - 请求数据，对象格式
 * @param method - HTTP请求方法（GET、POST、PUT、DELETE等）
 * @returns Promise<T> - 返回处理后的响应数据
 */
const request = <T>(url: string, data: any, method: Method): Promise<T> => {
  // 清理请求数据中的undefined值，避免发送无效参数
  for (const key in data) {
    if (data[key] === undefined) {
      delete data[key];
    }
  }

  return instance
    .request({
      url,
      method,
      // POST和PUT请求将数据放在请求体中
      data: ['POST', 'PUT'].includes(method) ? data : undefined,
      // GET和DELETE请求将数据作为查询参数
      params: !['POST', 'PUT'].includes(method) ? data : undefined
    })
    .then((res) => checkRes(res.data)) // 检查和处理响应数据
    .catch((err) => responseError(err)); // 统一处理请求错误
};

/**
 * API代理服务导出对象
 * 目前为空对象，后续将实现以下功能：
 * - 渠道管理（channel crud）
 * - 模型管理
 * - 请求转发
 * - 负载均衡
 * 
 * TODO: 实现渠道的增删改查功能
 * TODO: 添加模型管理接口
 * TODO: 实现请求路由和转发逻辑
 */
export const ApiProxy = {};
