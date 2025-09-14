# FastGPT MongoDB数据库表结构分析

## 概述

本文档详细梳理了FastGPT项目中所有MongoDB数据库表的结构、关联关系、作用及对应的代码文件位置。

## 数据库表结构总览

### 1. 用户管理模块

#### 1.1 users (用户表)
- **文件位置**: `packages/service/support/user/schema.ts`
- **集合名称**: `users`
- **作用**: 存储用户基本信息、认证信息和配置
- **主要字段**:
  - `_id`: 用户唯一标识
  - `status`: 用户状态 (active/inactive)
  - `username`: 用户名(手机/邮箱)
  - `phonePrefix`: 手机区号
  - `password`: 加密密码
  - `passwordUpdateTime`: 密码更新时间
  - `createTime`: 创建时间
  - `promotionRate`: 推广费率
  - `openaiAccount`: OpenAI账户配置
  - `timezone`: 时区设置
  - `lastLoginTmbId`: 最后登录的团队成员ID
  - `inviterId`: 邀请人ID
- **索引**: 无特殊索引
- **关联关系**:
  - 与 `team_members` 表通过 `lastLoginTmbId` 关联
  - 与自身通过 `inviterId` 关联(邀请关系)

#### 1.2 teams (团队表)
- **文件位置**: `packages/service/support/user/team/teamSchema.ts`
- **集合名称**: `teams`
- **作用**: 存储团队基本信息和配置
- **主要字段**:
  - `_id`: 团队唯一标识
  - `name`: 团队名称
  - `ownerId`: 团队所有者ID
  - `avatar`: 团队头像
  - `createTime`: 创建时间
  - `balance`: 团队余额
  - `teamDomain`: 团队域名
  - `lafAccount`: LAF账户配置
  - `limit`: 团队限制配置
  - `teamTags`: 团队标签
  - `maxSize`: 最大成员数
  - `defaultPermission`: 默认权限
  - `inheritPermission`: 是否继承权限
- **索引**:
  - `{ ownerId: 1 }`
  - `{ teamDomain: 1 }`
- **关联关系**:
  - 与 `users` 表通过 `ownerId` 关联
  - 与 `team_members` 表一对多关联

#### 1.3 team_members (团队成员表)
- **文件位置**: `packages/service/support/user/team/teamMemberSchema.ts`
- **集合名称**: `team_members`
- **作用**: 存储团队成员信息和权限
- **主要字段**:
  - `_id`: 成员唯一标识
  - `teamId`: 团队ID
  - `userId`: 用户ID
  - `name`: 成员名称
  - `role`: 成员角色
  - `status`: 成员状态
  - `createTime`: 加入时间
  - `defaultTeam`: 是否为默认团队
  - `permission`: 权限配置
- **索引**:
  - `{ teamId: 1, userId: 1 }` (唯一索引)
  - `{ userId: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `users` 表通过 `userId` 关联

#### 1.4 team_member_groups (成员组表)
- **文件位置**: `packages/service/support/permission/memberGroup/memberGroupSchema.ts`
- **集合名称**: `team_member_groups`
- **作用**: 管理团队成员分组
- **主要字段**:
  - `_id`: 成员组唯一标识
  - `teamId`: 团队ID
  - `name`: 组名
  - `description`: 描述
  - `members`: 成员列表
  - `createTime`: 创建时间
- **索引**:
  - `{ teamId: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表多对多关联

#### 1.5 team_orgs (组织表)
- **文件位置**: `packages/service/support/permission/org/orgSchema.ts`
- **集合名称**: `team_orgs`
- **作用**: 存储组织信息
- **主要字段**:
  - `_id`: 组织唯一标识
  - `name`: 组织名称
  - `description`: 组织描述
  - `createTime`: 创建时间
- **索引**: 无特殊索引
- **关联关系**:
  - 与 `team_org_members` 表一对多关联

#### 1.6 team_org_members (组织成员表)
- **文件位置**: `packages/service/support/permission/org/orgMemberSchema.ts`
- **集合名称**: `team_org_members`
- **作用**: 存储组织成员关系
- **主要字段**:
  - `_id`: 组织成员唯一标识
  - `orgId`: 组织ID
  - `tmbId`: 团队成员ID
  - `role`: 角色
  - `createTime`: 加入时间
- **索引**:
  - `{ orgId: 1, tmbId: 1 }` (唯一索引)
- **关联关系**:
  - 与 `team_orgs` 表通过 `orgId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联

#### 1.7 team_group_members (成员组关系表)
- **文件位置**: `packages/service/support/permission/memberGroup/groupMemberSchema.ts`
- **集合名称**: `team_group_members`
- **作用**: 存储成员组与团队成员的关系
- **主要字段**:
  - `_id`: 关系唯一标识
  - `groupId`: 成员组ID
  - `tmbId`: 团队成员ID
  - `role`: 在组内的角色
- **索引**:
  - `{ groupId: 1 }`
  - `{ tmbId: 1 }`
- **关联关系**:
  - 与 `team_member_groups` 表通过 `groupId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联

### 2. 权限管理模块

#### 2.1 resource_permissions (资源权限表)
- **文件位置**: `packages/service/support/permission/schema.ts`
- **集合名称**: `resource_permissions`
- **作用**: 管理各种资源的权限分配
- **主要字段**:
  - `_id`: 权限记录唯一标识
  - `teamId`: 团队ID
  - `tmbId`: 团队成员ID
  - `groupId`: 成员组ID
  - `orgId`: 组织ID
  - `resourceType`: 资源类型(app/dataset等)
  - `permission`: 权限值
  - `resourceId`: 资源ID
- **索引**: 无特殊索引
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `member_groups` 表通过 `groupId` 关联
  - 与 `orgs` 表通过 `orgId` 关联

### 3. 应用管理模块

#### 3.1 apps (应用表)
- **文件位置**: `packages/service/core/app/schema.ts`
- **集合名称**: `apps`
- **作用**: 存储AI应用的配置和工作流
- **主要字段**:
  - `_id`: 应用唯一标识
  - `parentId`: 父应用ID
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `name`: 应用名称
  - `type`: 应用类型
  - `version`: 版本
  - `avatar`: 应用头像
  - `intro`: 应用介绍
  - `updateTime`: 更新时间
  - `teamTags`: 团队标签
  - `modules`: 工作流模块
  - `edges`: 工作流连接
  - `chatConfig`: 聊天配置
  - `pluginData`: 插件数据
  - `scheduledTriggerConfig`: 定时触发配置
  - `scheduledTriggerNextTime`: 下次触发时间
  - `inited`: 是否已初始化
  - `inheritPermission`: 是否继承权限
- **索引**:
  - `{ type: 1 }`
  - `{ teamId: 1, updateTime: -1 }`
  - `{ teamId: 1, type: 1 }`
  - `{ scheduledTriggerConfig: 1, scheduledTriggerNextTime: -1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与自身通过 `parentId` 关联(应用层级)

#### 3.2 app_versions (应用版本表)
- **文件位置**: `packages/service/core/app/version/schema.ts`
- **集合名称**: `app_versions`
- **作用**: 存储应用的历史版本
- **主要字段**:
  - `_id`: 版本唯一标识
  - `appId`: 应用ID
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `time`: 创建时间
  - `nodes`: 节点配置
  - `edges`: 连接配置
  - `chatConfig`: 聊天配置
  - `isPublish`: 是否发布版本
  - `versionName`: 版本名称
- **索引**:
  - `{ appId: 1, time: -1 }`
- **关联关系**:
  - 与 `apps` 表通过 `appId` 关联
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联

#### 3.3 app_templates (应用模板表)
- **文件位置**: `packages/service/core/app/template/schema.ts`
- **集合名称**: `app_templates`
- **作用**: 存储应用模板
- **主要字段**:
  - `_id`: 模板唯一标识
  - `templateId`: 模板ID
  - `name`: 模板名称
  - `intro`: 模板介绍
  - `avatar`: 模板头像
  - `type`: 模板类型
  - `modules`: 模块配置
  - `edges`: 连接配置
  - `chatConfig`: 聊天配置
  - `workflow`: 工作流配置
- **索引**: 无特殊索引
- **关联关系**: 无直接关联

#### 3.4 app_template_types (应用模板类型表)
- **文件位置**: `packages/service/core/app/template/type/schema.ts`
- **集合名称**: `app_template_types`
- **作用**: 存储应用模板分类
- **主要字段**:
  - `_id`: 类型唯一标识
  - `name`: 类型名称
  - `description`: 类型描述
  - `sort`: 排序
- **索引**: 无特殊索引
- **关联关系**: 与 `app_templates` 表关联

### 4. 聊天管理模块

#### 4.1 chat (聊天表)
- **文件位置**: `packages/service/core/chat/chatSchema.ts`
- **集合名称**: `chat`
- **作用**: 存储聊天会话信息
- **主要字段**:
  - `_id`: 聊天唯一标识
  - `teamId`: 团队ID
  - `tmbId`: 团队成员ID
  - `appId`: 应用ID
  - `title`: 聊天标题
  - `customTitle`: 自定义标题
  - `top`: 是否置顶
  - `variables`: 变量
  - `source`: 来源
  - `shareId`: 分享ID
  - `outLinkUid`: 外链用户ID
  - `updateTime`: 更新时间
- **索引**:
  - `{ appId: 1, updateTime: -1 }`
  - `{ teamId: 1, tmbId: 1, updateTime: -1 }`
  - `{ shareId: 1 }`
  - `{ outLinkUid: 1, updateTime: -1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `apps` 表通过 `appId` 关联
  - 与 `outlinks` 表通过 `shareId` 关联

#### 4.2 chatitems (聊天项表)
- **文件位置**: `packages/service/core/chat/chatItemSchema.ts`
- **集合名称**: `chatitems`
- **作用**: 存储聊天消息记录
- **主要字段**:
  - `_id`: 聊天项唯一标识
  - `teamId`: 团队ID
  - `tmbId`: 团队成员ID
  - `chatId`: 聊天ID
  - `appId`: 应用ID
  - `time`: 消息时间
  - `obj`: 消息对象(human/AI)
  - `value`: 消息内容
  - `userGoodFeedback`: 用户好评
  - `userBadFeedback`: 用户差评
  - `customFeedbacks`: 自定义反馈
  - `adminFeedback`: 管理员反馈
  - `responseData`: 响应数据
- **索引**:
  - `{ chatId: 1, time: -1 }`
  - `{ appId: 1, time: -1 }`
  - `{ teamId: 1, time: -1 }`
- **关联关系**:
  - 与 `chats` 表通过 `chatId` 关联
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `apps` 表通过 `appId` 关联

#### 4.3 chat_settings (聊天设置表)
- **文件位置**: `packages/service/core/chat/setting/schema.ts`
- **集合名称**: `chat_settings`
- **作用**: 存储聊天界面设置
- **主要字段**:
  - `_id`: 设置唯一标识
  - `teamId`: 团队ID
  - `appId`: 应用ID
  - `slogan`: 标语
  - `dialogTips`: 对话提示
  - `selectedTools`: 选中的工具
  - `homeTabTitle`: 首页标签标题
  - `wideLogoUrl`: 宽版Logo URL
  - `squareLogoUrl`: 方形Logo URL
- **索引**:
  - `{ teamId: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `apps` 表通过 `appId` 关联

#### 4.4 chat_input_guides (聊天输入引导表)
- **文件位置**: `packages/service/core/chat/inputGuide/schema.ts`
- **集合名称**: `chat_input_guides`
- **作用**: 存储聊天输入引导配置
- **主要字段**:
  - `_id`: 引导唯一标识
  - `teamId`: 团队ID
  - `appId`: 应用ID
  - `text`: 引导文本
  - `icon`: 图标
  - `order`: 排序
- **索引**:
  - `{ appId: 1, order: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `apps` 表通过 `appId` 关联

### 5. 数据集管理模块

#### 5.1 datasets (数据集表)
- **文件位置**: `packages/service/core/dataset/schema.ts`
- **集合名称**: `datasets`
- **作用**: 存储知识库数据集信息
- **主要字段**:
  - `_id`: 数据集唯一标识
  - `parentId`: 父数据集ID
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `updateTime`: 更新时间
  - `type`: 数据集类型
  - `status`: 状态
  - `name`: 数据集名称
  - `avatar`: 头像
  - `intro`: 介绍
  - `permission`: 权限
  - `vectorModel`: 向量模型
  - `agentModel`: 代理模型
  - `inheritPermission`: 是否继承权限
  - `chunkSettings`: 分块设置
- **索引**:
  - `{ teamId: 1, updateTime: -1 }`
  - `{ teamId: 1, type: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与自身通过 `parentId` 关联(数据集层级)

#### 5.2 dataset_collections (数据集集合表)
- **文件位置**: `packages/service/core/dataset/collection/schema.ts`
- **集合名称**: `dataset_collections`
- **作用**: 存储数据集中的文件集合
- **主要字段**:
  - `_id`: 集合唯一标识
  - `parentId`: 父集合ID
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `datasetId`: 数据集ID
  - `type`: 集合类型
  - `name`: 集合名称
  - `tags`: 标签
  - `createTime`: 创建时间
  - `updateTime`: 更新时间
  - `fileId`: 文件ID
  - `rawLink`: 原始链接
  - `hashRawText`: 原始文本哈希
  - `rawTextLength`: 原始文本长度
  - `metadata`: 元数据
  - `trainingType`: 训练类型
  - `chunkSize`: 分块大小
  - `chunkSplitter`: 分块分隔符
  - `qaPrompt`: 问答提示
  - `forbid`: 是否禁用
- **索引**:
  - `{ teamId: 1, datasetId: 1, updateTime: -1 }`
  - `{ teamId: 1, datasetId: 1, type: 1 }`
  - `{ hashRawText: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `datasets` 表通过 `datasetId` 关联
  - 与自身通过 `parentId` 关联(集合层级)

#### 5.3 dataset_datas (数据集数据表)
- **文件位置**: `packages/service/core/dataset/data/schema.ts`
- **集合名称**: `dataset_datas`
- **作用**: 存储数据集中的具体数据条目
- **主要字段**:
  - `_id`: 数据唯一标识
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `datasetId`: 数据集ID
  - `collectionId`: 集合ID
  - `q`: 问题
  - `a`: 答案
  - `imageId`: 图片ID
  - `imageDescMap`: 图片描述映射
  - `history`: 历史记录
  - `indexes`: 索引信息
  - `updateTime`: 更新时间
  - `chunkIndex`: 分块索引
  - `rebuilding`: 是否重建中
- **索引**:
  - `{ teamId: 1, datasetId: 1, collectionId: 1, chunkIndex: 1, updateTime: -1 }`
  - `{ teamId: 1, datasetId: 1, collectionId: 1, 'indexes.dataId': 1 }`
  - `{ rebuilding: 1, teamId: 1, datasetId: 1 }`
  - `{ initJieba: 1, updateTime: 1 }`
  - `{ updateTime: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `datasets` 表通过 `datasetId` 关联
  - 与 `dataset_collections` 表通过 `collectionId` 关联

#### 5.4 dataset_trainings (数据集训练表)
- **文件位置**: `packages/service/core/dataset/training/schema.ts`
- **集合名称**: `dataset_trainings`
- **作用**: 存储数据集训练任务信息
- **主要字段**:
  - `_id`: 训练任务唯一标识
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `datasetId`: 数据集ID
  - `collectionId`: 集合ID
  - `billId`: 账单ID
  - `mode`: 训练模式
  - `expireAt`: 过期时间
  - `lockTime`: 锁定时间
  - `model`: 模型
  - `q`: 问题
  - `a`: 答案
  - `chunkIndex`: 分块索引
  - `weight`: 权重
  - `indexes`: 索引
  - `retry`: 重试次数
- **索引**:
  - `{ teamId: 1, datasetId: 1, lockTime: 1 }`
  - `{ expireAt: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `datasets` 表通过 `datasetId` 关联
  - 与 `dataset_collections` 表通过 `collectionId` 关联

#### 5.5 dataset_collection_tags (数据集集合标签表)
- **文件位置**: `packages/service/core/dataset/collection/tag/schema.ts`
- **集合名称**: `dataset_collection_tags`
- **作用**: 存储数据集集合的标签信息
- **主要字段**:
  - `_id`: 标签唯一标识
  - `teamId`: 团队ID
  - `datasetId`: 数据集ID
  - `tag`: 标签名称
  - `createTime`: 创建时间
- **索引**:
  - `{ teamId: 1, datasetId: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `datasets` 表通过 `datasetId` 关联

### 6. 文件管理模块

#### 6.1 dataset.files (数据集文件表)
- **文件位置**: `packages/service/common/file/gridfs/schema.ts`
- **集合名称**: `dataset.files`
- **作用**: 存储数据集相关文件(GridFS)
- **主要字段**:
  - `_id`: 文件唯一标识
  - `length`: 文件大小
  - `chunkSize`: 分块大小
  - `uploadDate`: 上传日期
  - `filename`: 文件名
  - `contentType`: 内容类型
  - `metadata`: 元数据
- **索引**:
  - `{ uploadDate: -1 }`
- **关联关系**: 通过metadata与其他表关联

#### 6.2 chat.files (聊天文件表)
- **文件位置**: `packages/service/common/file/gridfs/schema.ts`
- **集合名称**: `chat.files`
- **作用**: 存储聊天相关文件(GridFS)
- **主要字段**:
  - `_id`: 文件唯一标识
  - `length`: 文件大小
  - `chunkSize`: 分块大小
  - `uploadDate`: 上传日期
  - `filename`: 文件名
  - `contentType`: 内容类型
  - `metadata`: 元数据
- **索引**:
  - `{ uploadDate: -1 }`
  - `{ 'metadata.chatId': 1 }`
- **关联关系**: 通过metadata.chatId与chats表关联

#### 6.3 dataset_image.files (数据集图片文件表)
- **文件位置**: `packages/service/core/dataset/image/schema.ts`
- **集合名称**: `dataset_image.files`
- **作用**: 存储数据集图片文件(GridFS)
- **主要字段**:
  - `_id`: 文件唯一标识
  - `length`: 文件大小
  - `chunkSize`: 分块大小
  - `uploadDate`: 上传日期
  - `filename`: 文件名
  - `contentType`: 内容类型
  - `metadata`: 元数据(包含teamId, datasetId, collectionId, expiredTime)
- **索引**:
  - `{ 'metadata.datasetId': 'hashed' }`
  - `{ 'metadata.collectionId': 'hashed' }`
  - `{ 'metadata.expiredTime': -1 }`
- **关联关系**: 通过metadata与teams、datasets、dataset_collections表关联

### 7. 外链分享模块

#### 7.1 outlinks (外链表)
- **文件位置**: `packages/service/support/outLink/schema.ts`
- **集合名称**: `outlinks`
- **作用**: 存储应用外链分享配置
- **主要字段**:
  - `_id`: 外链唯一标识
  - `shareId`: 分享ID
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `appId`: 应用ID
  - `name`: 外链名称
  - `usagePoints`: 使用积分
  - `total`: 总使用次数
  - `lastTime`: 最后使用时间
  - `expiredTime`: 过期时间
  - `limit`: 限制配置
  - `responseDetail`: 响应详情
  - `customUid`: 自定义用户ID
  - `outLinkAuthList`: 外链认证列表
- **索引**:
  - `{ shareId: 1 }` (唯一索引)
  - `{ teamId: 1 }`
  - `{ appId: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `apps` 表通过 `appId` 关联

### 8. 使用统计模块

#### 8.1 usages (使用记录表)
- **文件位置**: `packages/service/support/wallet/usage/schema.ts`
- **集合名称**: `usages`
- **作用**: 存储各种资源使用记录和计费信息
- **主要字段**:
  - `_id`: 使用记录唯一标识
  - `teamId`: 团队ID
  - `tmbId`: 团队成员ID
  - `appId`: 应用ID
  - `chatId`: 聊天ID
  - `datasetId`: 数据集ID
  - `source`: 来源
  - `time`: 使用时间
  - `totalPoints`: 总积分
  - `list`: 使用详情列表
- **索引**:
  - `{ teamId: 1, time: -1 }`
  - `{ time: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `apps` 表通过 `appId` 关联
  - 与 `chats` 表通过 `chatId` 关联
  - 与 `datasets` 表通过 `datasetId` 关联

### 9. 系统配置模块

#### 9.1 system_models (系统模型表)
- **文件位置**: `packages/service/core/ai/config/schema.ts`
- **集合名称**: `system_models`
- **作用**: 存储系统AI模型配置
- **主要字段**:
  - `_id`: 模型唯一标识
  - `model`: 模型名称
  - `metadata`: 模型元数据
- **索引**:
  - `{ model: 1 }` (唯一索引)
- **关联关系**: 无直接关联

#### 9.2 systemconfigs (系统配置表)
- **文件位置**: `packages/service/common/system/config/schema.ts`
- **集合名称**: `systemconfigs`
- **作用**: 存储系统全局配置
- **主要字段**:
  - `_id`: 配置唯一标识
  - `type`: 配置类型
  - `value`: 配置值
- **索引**:
  - `{ type: 1 }` (唯一索引)
- **关联关系**: 无直接关联

#### 9.3 system_logs (系统日志表)
- **文件位置**: `packages/service/common/system/log/schema.ts`
- **集合名称**: `system_logs`
- **作用**: 存储系统运行日志
- **主要字段**:
  - `_id`: 日志唯一标识
  - `text`: 日志内容
  - `level`: 日志级别
  - `time`: 日志时间
  - `metadata`: 元数据
- **索引**:
  - `{ time: 1 }` (15天过期)
  - `{ level: 1 }`
- **关联关系**: 无直接关联

#### 9.4 systemtimerlocks (系统定时锁表)
- **文件位置**: `packages/service/common/system/timerLock/schema.ts`
- **集合名称**: `systemtimerlocks`
- **作用**: 系统定时任务锁机制
- **主要字段**:
  - `_id`: 锁唯一标识
  - `timerId`: 定时器ID
  - `expiredTime`: 过期时间
- **索引**:
  - `{ expiredTime: 1 }` (5秒过期)
- **关联关系**: 无直接关联

### 10. API管理模块

#### 10.1 openapis (开放API表)
- **文件位置**: `packages/service/support/openapi/schema.ts`
- **集合名称**: `openapis`
- **作用**: 存储开放API密钥和配置
- **主要字段**:
  - `_id`: API唯一标识
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `name`: API名称
  - `apiKey`: API密钥
  - `appId`: 关联应用ID
  - `usage`: 使用统计
  - `limit`: 限制配置
  - `createTime`: 创建时间
  - `lastUsedTime`: 最后使用时间
- **索引**:
  - `{ apiKey: 1 }` (唯一索引)
  - `{ teamId: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `apps` 表通过 `appId` 关联

#### 10.2 mcp_keys (MCP密钥表)
- **文件位置**: `packages/service/support/mcp/schema.ts`
- **集合名称**: `mcp_keys`
- **作用**: 存储MCP(Model Context Protocol)密钥
- **主要字段**:
  - `_id`: 密钥唯一标识
  - `name`: 密钥名称
  - `key`: 密钥值
  - `teamId`: 团队ID
  - `tmbId`: 创建者ID
  - `apps`: 关联应用列表
- **索引**:
  - `{ key: 1 }` (唯一索引)
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联
  - 与 `apps` 表通过 `apps.appId` 关联

### 11. 认证模块

#### 11.1 auth_codes (认证码表)
- **文件位置**: `packages/service/support/user/authCode/schema.ts`
- **集合名称**: `auth_codes`
- **作用**: 存储用户认证码(验证码)
- **主要字段**:
  - `_id`: 认证码唯一标识
  - `username`: 用户名
  - `code`: 验证码
  - `type`: 验证码类型
  - `expiredTime`: 过期时间
  - `createTime`: 创建时间
- **索引**:
  - `{ username: 1, type: 1 }`
  - `{ expiredTime: 1 }` (自动过期)
- **关联关系**: 与users表通过username关联

### 12. 审计日志模块

#### 12.1 operationLogs (操作日志表)
- **文件位置**: `packages/service/support/user/audit/schema.ts`
- **集合名称**: `operationLogs`
- **作用**: 存储用户操作审计日志
- **主要字段**:
  - `_id`: 日志唯一标识
  - `tmbId`: 团队成员ID
  - `teamId`: 团队ID
  - `timestamp`: 时间戳
  - `event`: 事件类型
  - `metadata`: 元数据
- **索引**:
  - `{ teamId: 1, tmbId: 1, event: 1 }`
  - `{ timestamp: 1 }` (14天自动删除)
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联
  - 与 `team_members` 表通过 `tmbId` 关联

### 13. 推广模块

#### 13.1 promotionRecord (推广记录表)
- **文件位置**: `packages/service/support/wallet/promotion/schema.ts`
- **集合名称**: `promotionRecord`
- **作用**: 存储推广奖励记录
- **主要字段**:
  - `_id`: 记录唯一标识
  - `type`: 推广类型
  - `createTime`: 创建时间
  - `amount`: 奖励金额
  - `userId`: 用户ID
  - `objUId`: 目标用户ID
- **索引**:
  - `{ userId: 1, createTime: -1 }`
- **关联关系**:
  - 与 `users` 表通过 `userId` 关联
  - 与 `users` 表通过 `objUId` 关联

### 14. 临时数据模块

#### 14.1 tmp_datas (临时数据表)
- **文件位置**: `packages/service/common/buffer/tmpData/schema.ts`
- **集合名称**: `tmp_datas`
- **作用**: 存储临时数据
- **主要字段**:
  - `_id`: 数据唯一标识
  - `dataId`: 数据ID
  - `data`: 数据内容
  - `expiredTime`: 过期时间
- **索引**:
  - `{ dataId: 1 }` (唯一索引)
  - `{ expiredTime: 1 }` (自动过期)
- **关联关系**: 无直接关联

#### 14.2 buffer_rawtext (缓冲原始文本表)
- **文件位置**: `packages/service/common/buffer/rawText/schema.ts`
- **集合名称**: `buffer_rawtext`
- **作用**: 缓冲原始文本数据
- **主要字段**:
  - `_id`: 缓冲唯一标识
  - `rawText`: 原始文本
  - `expiredTime`: 过期时间
- **索引**:
  - `{ expiredTime: 1 }` (自动过期)
- **关联关系**: 无直接关联

### 15. 订阅模块

#### 15.1 team_subscriptions (团队订阅表)
- **文件位置**: `packages/service/support/wallet/sub/schema.ts`
- **集合名称**: `team_subscriptions`
- **作用**: 存储团队订阅信息
- **主要字段**:
  - `_id`: 订阅唯一标识
  - `teamId`: 团队ID
  - `type`: 订阅类型
  - `status`: 订阅状态
  - `startTime`: 开始时间
  - `expiredTime`: 过期时间
  - `price`: 价格
  - `currentSubLevel`: 当前订阅级别
  - `nextSubLevel`: 下一订阅级别
- **索引**:
  - `{ teamId: 1 }`
  - `{ expiredTime: 1 }`
- **关联关系**:
  - 与 `teams` 表通过 `teamId` 关联

## 数据库表关联关系图

### 核心关联关系

1. **用户-团队关系**:
   - `users` ← `teams.ownerId`
   - `users` ← `team_members.userId` → `teams`
   - `team_members` ← `member_groups.members`
   - `team_members` ← `org_members.tmbId` → `orgs`

2. **权限管理关系**:
   - `resource_permissions` → `teams`
   - `resource_permissions` → `team_members`
   - `resource_permissions` → `member_groups`
   - `resource_permissions` → `orgs`

3. **应用管理关系**:
   - `apps` → `teams`
   - `apps` → `team_members`
   - `apps` ← `app_versions.appId`
   - `apps` ← `chat_settings.appId`
   - `apps` ← `chat_input_guides.appId`

4. **聊天管理关系**:
   - `chats` → `teams`
   - `chats` → `team_members`
   - `chats` → `apps`
   - `chats` ← `chatitems.chatId`
   - `chats` → `outlinks.shareId`

5. **数据集管理关系**:
   - `datasets` → `teams`
   - `datasets` → `team_members`
   - `datasets` ← `dataset_collections.datasetId`
   - `dataset_collections` ← `dataset_datas.collectionId`
   - `dataset_collections` ← `dataset_trainings.collectionId`
   - `datasets` ← `dataset_collection_tags.datasetId`

6. **文件管理关系**:
   - `dataset.files` 通过metadata关联其他表
   - `chat.files` 通过metadata.chatId关联 `chats`
   - `dataset_image.files` 通过metadata关联 `teams`、`datasets`、`dataset_collections`

7. **使用统计关系**:
   - `usages` → `teams`
   - `usages` → `team_members`
   - `usages` → `apps`
   - `usages` → `chats`
   - `usages` → `datasets`

8. **API管理关系**:
   - `openapis` → `teams`
   - `openapis` → `team_members`
   - `openapis` → `apps`
   - `mcp_keys` → `teams`
   - `mcp_keys` → `team_members`
   - `mcp_keys` → `apps`

## 总结

FastGPT项目的MongoDB数据库设计采用了模块化的架构，主要包含以下几个核心模块:

1. **用户管理模块**: 处理用户、团队、组织的基础信息和关系
2. **权限管理模块**: 实现细粒度的资源权限控制
3. **应用管理模块**: 管理AI应用的配置、版本和模板
4. **聊天管理模块**: 处理聊天会话和消息记录
5. **数据集管理模块**: 管理知识库数据集和训练数据
6. **文件管理模块**: 使用GridFS存储各类文件
7. **外链分享模块**: 处理应用的外部分享
8. **使用统计模块**: 记录资源使用和计费信息
9. **系统配置模块**: 管理系统级配置和日志
10. **API管理模块**: 管理开放API和MCP密钥
11. **认证模块**: 处理用户认证和验证码
12. **审计日志模块**: 记录用户操作日志
13. **推广模块**: 管理推广奖励
14. **临时数据模块**: 处理临时和缓冲数据
15. **订阅模块**: 管理团队订阅信息

整个数据库设计以团队(teams)为核心，通过团队成员(team_members)建立用户与团队的关系，再通过各种资源表与团队的关联实现多租户架构。权限管理通过resource_permissions表实现细粒度控制，支持用户、成员组、组织等多种权限主体。

数据库设计充分考虑了查询性能，在关键字段上建立了合适的索引，并使用了TTL索引实现数据自动过期清理。整体架构具有良好的可扩展性和维护性。