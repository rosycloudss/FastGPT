/**
 * 数据集队列工具模块
 * 
 * 提供数据集队列处理过程中的通用工具函数，主要包括：
 * - 团队AI积分检查和锁定功能
 * - 余额不足时的通知和数据锁定处理
 * 
 * @module dataset/queues/utils
 */

// 团队错误枚举
import { TeamErrEnum } from '@fastgpt/global/common/error/code/team';
// 团队AI积分检查功能
import { checkTeamAIPoints } from '@fastgpt/service/support/permission/teamLimit';
// 用户通知发送功能
import { sendOneInform } from '../../../support/user/inform/api';
// 训练数据锁定控制器
import { lockTrainingDataByTeamId } from '@fastgpt/service/core/dataset/training/controller';
// 通知级别枚举
import { InformLevelEnum } from '@fastgpt/global/support/user/inform/constants';

/**
 * 检查团队AI积分并在不足时锁定训练数据
 * 
 * 该函数用于在数据集队列处理前检查团队的AI积分余额：
 * 1. 检查团队AI积分是否充足
 * 2. 如果积分不足，发送紧急通知给团队
 * 3. 锁定该团队的所有训练数据，暂停处理
 * 
 * @param teamId - 团队ID
 * @returns Promise<boolean> - 返回积分检查结果，true表示积分充足，false表示积分不足
 * 
 * @example
 * ```typescript
 * const canProceed = await checkTeamAiPointsAndLock('team123');
 * if (canProceed) {
 *   // 继续处理队列任务
 * } else {
 *   // 积分不足，已自动锁定数据
 * }
 * ```
 */
export const checkTeamAiPointsAndLock = async (teamId: string) => {
  try {
    // 检查团队AI积分是否充足
    await checkTeamAIPoints(teamId);
    return true;
  } catch (error: any) {
    // 如果是积分不足错误
    if (error === TeamErrEnum.aiPointsNotEnough) {
      // 发送通知并锁定数据
      try {
        // 发送紧急通知给团队
        sendOneInform({
          level: InformLevelEnum.emergency,
          templateCode: 'LACK_OF_POINTS',
          templateParam: {},
          teamId
        });
        console.log('余额不足，暂停知识库处理');
        // 锁定该团队的所有训练数据
        await lockTrainingDataByTeamId(teamId);
      } catch (error) {
        // 忽略通知发送或锁定过程中的错误
      }
    }
    return false;
  }
};
