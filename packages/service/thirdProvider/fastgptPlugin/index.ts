import createClient from '@fastgpt-sdk/plugin';

export const BASE_URL = process.env.PLUGIN_BASE_URL || '';
export const TOKEN = process.env.PLUGIN_TOKEN || '';

// 创建一个安全的插件客户端，当BASE_URL为空时返回模拟的空响应
const createSafePluginClient = () => {
  if (!BASE_URL) {
    // 当没有配置PLUGIN_BASE_URL时，返回一个模拟客户端
    return {
      model: {
        list: () => Promise.resolve({ status: 200, body: [] })
      },
      tool: {
        list: () => Promise.resolve({ status: 200, body: [] })
      }
    };
  }

  return createClient({
    baseUrl: BASE_URL,
    token: TOKEN
  });
};

export const pluginClient = createSafePluginClient();
