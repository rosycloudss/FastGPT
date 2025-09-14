/**
 * 应用工具函数模块
 * 提供应用相关的核心功能，包括定时任务触发、工作流执行等
 */

// 权限和团队相关
import { getUserChatInfoAndAuthTeamPoints } from '@fastgpt/service/support/permission/auth/team';
import { getRunningUserInfoByTmbId } from '@fastgpt/service/support/user/team/utils';

// 钱包和使用量相关
import { createChatUsage } from '@fastgpt/service/support/wallet/usage/controller';
import { UsageSourceEnum } from '@fastgpt/global/support/wallet/usage/constants';

// 时间和字符串工具
import { getNextTimeByCronStringAndTimezone } from '@fastgpt/global/common/string/time';
import { getNanoid } from '@fastgpt/global/common/string/tools';

// 系统工具函数
import { delay, retryFn } from '@fastgpt/global/common/system/utils';
import { getErrText } from '@fastgpt/global/common/error/utils';

// 聊天相关常量和类型
import {
  ChatItemValueTypeEnum,
  ChatRoleEnum,
  ChatSourceEnum
} from '@fastgpt/global/core/chat/constants';
import { type UserChatItemValueItemType } from '@fastgpt/global/core/chat/type';

// 工作流相关
import {
  getWorkflowEntryNodeIds,
  storeEdges2RuntimeEdges,
  storeNodes2RuntimeNodes
} from '@fastgpt/global/core/workflow/runtime/utils';
import { WORKFLOW_MAX_RUN_TIMES } from '@fastgpt/service/core/workflow/constants';
import { dispatchWorkFlow } from '@fastgpt/service/core/workflow/dispatch';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';

// 日志和数据库
import { addLog } from '@fastgpt/service/common/system/log';
import { MongoApp } from '@fastgpt/service/core/app/schema';

// 聊天和应用版本管理
import { saveChat } from '@fastgpt/service/core/chat/saveChat';
import { getAppLatestVersion } from '@fastgpt/service/core/app/version/controller';

/**
 * 获取并执行定时触发的应用
 * 该函数负责查找所有配置了定时触发的应用，并按计划执行它们
 * 主要用于实现应用的定时任务功能，如定期数据处理、报告生成等
 * 
 * @returns Promise<void> - 异步执行，无返回值
 */
export const getScheduleTriggerApp = async () => {
  // 记录定时任务开始执行的日志
  addLog.info('Schedule trigger app');

  // 1. 查找所有需要执行的定时触发应用
  // 条件：存在定时触发配置且下次执行时间已到
  const apps = await retryFn(() => {
    return MongoApp.find({
      scheduledTriggerConfig: { $exists: true }, // 存在定时触发配置
      scheduledTriggerNextTime: { $lte: new Date() } // 下次执行时间小于等于当前时间
    });
  });

  // 2. 并发执行所有符合条件的应用
  // 使用 Promise.allSettled 确保即使某个应用执行失败也不会影响其他应用
  await Promise.allSettled(
    apps.map(async (app) => {
      // 检查应用是否有定时触发配置
      if (!app.scheduledTriggerConfig) return;
      
      // 为每次执行生成唯一的聊天ID
      const chatId = getNanoid();
      
      // 随机延迟0-60秒，避免所有应用同时执行造成系统压力
      await delay(Math.floor(Math.random() * 60 * 1000));
      
      // 获取用户聊天信息和团队权限验证
      const { timezone, externalProvider } = await retryFn(() =>
        getUserChatInfoAndAuthTeamPoints(app.tmbId)
      );

      // 获取应用的最新版本配置
      // 包括工作流节点、边连接和聊天配置
      const { nodes, edges, chatConfig } = await retryFn(() => getAppLatestVersion(app._id, app));
      
      // 构造用户查询内容，使用配置中的默认提示词
      const userQuery: UserChatItemValueItemType[] = [
        {
          type: ChatItemValueTypeEnum.text, // 文本类型的消息
          text: {
            content: app.scheduledTriggerConfig?.defaultPrompt // 使用定时任务配置的默认提示词
          }
        }
      ];

      try {
        // 执行工作流，获取执行结果
        const { flowUsages, assistantResponses, flowResponses, durationSeconds, system_memories } =
          await retryFn(async () => {
            return dispatchWorkFlow({
              chatId, // 聊天会话ID
              timezone, // 用户时区
              externalProvider, // 外部服务提供商配置
              mode: 'chat', // 执行模式为聊天模式
              runningAppInfo: {
                id: String(app._id), // 应用ID
                teamId: String(app.teamId), // 团队ID
                tmbId: String(app.tmbId) // 团队成员ID
              },
              runningUserInfo: await getRunningUserInfoByTmbId(app.tmbId), // 运行用户信息
              uid: String(app.tmbId), // 用户唯一标识
              runtimeNodes: storeNodes2RuntimeNodes(nodes, getWorkflowEntryNodeIds(nodes)), // 运行时节点
              runtimeEdges: storeEdges2RuntimeEdges(edges), // 运行时边连接
              variables: {}, // 工作流变量（定时任务中为空）
              query: userQuery, // 用户查询内容
              chatConfig, // 聊天配置
              histories: [], // 历史对话（定时任务中为空）
              stream: false, // 非流式响应
              maxRunTimes: WORKFLOW_MAX_RUN_TIMES // 最大运行次数限制
            });
          });

        // 获取工作流执行过程中的错误信息（如果有）
        const error = flowResponses[flowResponses.length - 1]?.error;

        // 保存聊天记录，记录定时任务的执行结果
        await saveChat({
          chatId, // 聊天会话ID
          appId: app._id, // 应用ID
          teamId: String(app.teamId), // 团队ID
          tmbId: String(app.tmbId), // 团队成员ID
          nodes, // 工作流节点
          appChatConfig: chatConfig, // 应用聊天配置
          variables: {}, // 变量（定时任务中为空）
          isUpdateUseTime: false, // 不更新使用时间（由所有者更新）
          newTitle: 'Cron Job', // 聊天标题标识为定时任务
          source: ChatSourceEnum.cronJob, // 来源标识为定时任务
          content: [
            {
              obj: ChatRoleEnum.Human, // 用户角色
              value: userQuery // 用户输入的查询内容
            },
            {
              obj: ChatRoleEnum.AI, // AI助手角色
              value: assistantResponses, // AI的响应内容
              [DispatchNodeResponseKeyEnum.nodeResponse]: flowResponses, // 节点响应详情
              memories: system_memories // 系统记忆
            }
          ],
          durationSeconds, // 执行耗时
          errorMsg: getErrText(error) // 错误信息（如果有）
        });
        // 创建使用量记录，用于计费和统计
        createChatUsage({
          appName: app.name, // 应用名称
          appId: app._id, // 应用ID
          teamId: String(app.teamId), // 团队ID
          tmbId: String(app.tmbId), // 团队成员ID
          source: UsageSourceEnum.cronJob, // 使用来源为定时任务
          flowUsages // 工作流使用量详情
        });
      } catch (error) {
        // 记录定时任务执行错误
        addLog.error('Schedule trigger error', error);

        // 即使执行失败也要保存聊天记录，便于问题排查
        await saveChat({
          chatId, // 聊天会话ID
          appId: app._id, // 应用ID
          teamId: String(app.teamId), // 团队ID
          tmbId: String(app.tmbId), // 团队成员ID
          nodes, // 工作流节点
          appChatConfig: chatConfig, // 应用聊天配置
          variables: {}, // 变量（定时任务中为空）
          isUpdateUseTime: false, // 不更新使用时间
          newTitle: 'Cron Job', // 聊天标题标识为定时任务
          source: ChatSourceEnum.cronJob, // 来源标识为定时任务
          content: [
            {
              obj: ChatRoleEnum.Human, // 用户角色
              value: userQuery // 用户输入的查询内容
            },
            {
              obj: ChatRoleEnum.AI, // AI助手角色
              value: [], // 空的AI响应（因为执行失败）
              [DispatchNodeResponseKeyEnum.nodeResponse]: [] // 空的节点响应
            }
          ],
          durationSeconds: 0, // 执行时间为0（因为失败）
          errorMsg: getErrText(error) // 错误信息
        });
      }

      // 更新下次执行时间
      // 根据cron表达式和时区计算下次触发时间
      app.scheduledTriggerNextTime = getNextTimeByCronStringAndTimezone(app.scheduledTriggerConfig);
      // 保存应用配置，忽略保存失败的错误
      await app.save().catch();
    })
  );
};
