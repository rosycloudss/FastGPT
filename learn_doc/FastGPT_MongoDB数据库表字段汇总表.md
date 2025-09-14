# FastGPT MongoDB数据库表字段汇总表

## 数据库表完整列表

根据代码分析，FastGPT项目共包含以下MongoDB集合：

| 序号 | 集合名称 | 中文名称 | 模块 | 文件位置 |
|------|----------|----------|------|----------|
| 1 | users | 用户表 | 用户管理 | packages/service/support/user/schema.ts |
| 2 | teams | 团队表 | 用户管理 | packages/service/support/user/team/teamSchema.ts |
| 3 | team_members | 团队成员表 | 用户管理 | packages/service/support/user/team/teamMemberSchema.ts |
| 4 | team_member_groups | 成员组表 | 用户管理 | packages/service/support/permission/memberGroup/memberGroupSchema.ts |
| 5 | team_group_members | 成员组关系表 | 用户管理 | packages/service/support/permission/memberGroup/groupMemberSchema.ts |
| 6 | team_orgs | 组织表 | 用户管理 | packages/service/support/permission/org/orgSchema.ts |
| 7 | team_org_members | 组织成员表 | 用户管理 | packages/service/support/permission/org/orgMemberSchema.ts |
| 8 | team_tags | 团队标签表 | 用户管理 | - |
| 9 | resource_permissions | 资源权限表 | 权限管理 | packages/service/support/permission/schema.ts |
| 10 | apps | 应用表 | 应用管理 | packages/service/core/app/schema.ts |
| 11 | app_versions | 应用版本表 | 应用管理 | packages/service/core/app/version/schema.ts |
| 12 | app_templates | 应用模板表 | 应用管理 | packages/service/core/app/templates/templateSchema.ts |
| 13 | app_template_types | 应用模板类型表 | 应用管理 | packages/service/core/app/templates/templateTypeSchema.ts |
| 14 | app_system_plugins | 系统插件表 | 应用管理 | packages/service/core/app/plugin/systemPluginSchema.ts |
| 15 | app_plugin_groups | 插件组表 | 应用管理 | packages/service/core/app/plugin/pluginGroupSchema.ts |
| 16 | chat | 聊天表 | 聊天管理 | packages/service/core/chat/chatSchema.ts |
| 17 | chatitems | 聊天项表 | 聊天管理 | packages/service/core/chat/chatItemSchema.ts |
| 18 | chat_settings | 聊天设置表 | 聊天管理 | packages/service/core/chat/setting/schema.ts |
| 19 | chat_input_guides | 聊天输入指南表 | 聊天管理 | packages/service/core/chat/inputGuide/schema.ts |
| 20 | app_chat_logs | 应用聊天日志表 | 聊天管理 | packages/service/core/app/logs/chatLogsSchema.ts |
| 21 | datasets | 数据集表 | 数据集管理 | packages/service/core/dataset/schema.ts |
| 22 | dataset_collections | 数据集集合表 | 数据集管理 | packages/service/core/dataset/collection/schema.ts |
| 23 | dataset_collection_tags | 数据集集合标签表 | 数据集管理 | packages/service/core/dataset/tag/schema.ts |
| 24 | dataset_datas | 数据集数据表 | 数据集管理 | packages/service/core/dataset/data/schema.ts |
| 25 | dataset_data_texts | 数据集数据文本表 | 数据集管理 | packages/service/core/dataset/data/dataTextSchema.ts |
| 26 | dataset_trainings | 数据集训练表 | 数据集管理 | packages/service/core/dataset/training/schema.ts |
| 27 | dataset.files | 数据集文件表(GridFS) | 文件管理 | packages/service/common/file/gridfs/schema.ts |
| 28 | chat.files | 聊天文件表(GridFS) | 文件管理 | packages/service/common/file/gridfs/schema.ts |
| 29 | dataset_image | 数据集图片表 | 文件管理 | - |
| 30 | usages | 使用记录表 | 使用统计 | packages/service/support/wallet/usage/schema.ts |
| 31 | openapi | API密钥表 | API管理 | packages/service/support/openapi/schema.ts |
| 32 | mcp_keys | MCP密钥表 | API管理 | packages/service/support/mcp/schema.ts |
| 33 | outlinks | 外链分享表 | 分享管理 | packages/service/support/outLink/schema.ts |
| 34 | auth_codes | 认证码表 | 认证管理 | packages/service/support/user/authCode/schema.ts |
| 35 | operationLogs | 操作日志表 | 审计日志 | packages/service/support/user/audit/schema.ts |
| 36 | promotionRecord | 推广记录表 | 推广管理 | packages/service/support/wallet/promotion/schema.ts |
| 37 | tmp_datas | 临时数据表 | 临时数据 | packages/service/support/tmpData/schema.ts |
| 38 | buffer_rawtext | 缓冲原始文本表 | 临时数据 | packages/service/common/buffer/rawText/schema.ts |
| 39 | buffer_tts | TTS缓冲表 | 临时数据 | packages/service/common/buffer/tts/schema.ts |
| 40 | team_subscriptions | 团队订阅表 | 订阅管理 | packages/service/support/wallet/sub/schema.ts |
| 41 | team_sub_coupons | 团队订阅优惠券表 | 订阅管理 | packages/service/support/wallet/coupon/schema.ts |
| 42 | system_logs | 系统日志表 | 系统管理 | packages/service/common/system/log/schema.ts |
| 43 | systemConfigs | 系统配置表 | 系统管理 | packages/service/common/system/config/schema.ts |
| 44 | systemtimerlocks | 系统定时锁表 | 系统管理 | packages/service/common/system/timerLock/schema.ts |
| 45 | eval | 评估表 | 评估管理 | packages/service/core/app/evaluation/evalSchema.ts |
| 46 | eval_items | 评估项表 | 评估管理 | packages/service/core/app/evaluation/evalItemSchema.ts |

## 核心表字段详细信息

### 1. users (用户表)

| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| _id | ObjectId | 是 | 主键 | 用户唯一标识 |
| status | String | 否 | 否 | 用户状态(active/inactive) |
| username | String | 是 | 否 | 用户名(手机/邮箱) |
| phonePrefix | String | 否 | 否 | 手机区号 |
| password | String | 是 | 否 | 加密密码 |
| passwordUpdateTime | Date | 否 | 否 | 密码更新时间 |
| createTime | Date | 否 | 否 | 创建时间 |
| promotionRate | Number | 否 | 否 | 推广费率 |
| openaiAccount | Object | 否 | 否 | OpenAI账户配置 |
| timezone | String | 否 | 否 | 时区设置 |
| lastLoginTmbId | ObjectId | 否 | 否 | 最后登录的团队成员ID |
| inviterId | ObjectId | 否 | 否 | 邀请人ID |

### 2. teams (团队表)

| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| _id | ObjectId | 是 | 主键 | 团队唯一标识 |
| name | String | 是 | 否 | 团队名称 |
| ownerId | ObjectId | 是 | 是 | 团队所有者ID |
| avatar | String | 否 | 否 | 团队头像 |
| createTime | Date | 否 | 否 | 创建时间 |
| balance | Number | 否 | 否 | 团队余额 |
| teamDomain | String | 否 | 是 | 团队域名 |
| lafAccount | Object | 否 | 否 | LAF账户配置 |
| limit | Object | 否 | 否 | 团队限制配置 |
| teamTags | Array | 否 | 否 | 团队标签 |
| maxSize | Number | 否 | 否 | 最大成员数 |
| defaultPermission | Object | 否 | 否 | 默认权限 |
| inheritPermission | Boolean | 否 | 否 | 是否继承权限 |

### 3. team_members (团队成员表)

| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| _id | ObjectId | 是 | 主键 | 成员唯一标识 |
| teamId | ObjectId | 是 | 是 | 团队ID |
| userId | ObjectId | 是 | 是 | 用户ID |
| name | String | 是 | 否 | 成员名称 |
| role | String | 是 | 否 | 成员角色 |
| status | String | 是 | 否 | 成员状态 |
| createTime | Date | 否 | 否 | 加入时间 |
| defaultTeam | Boolean | 否 | 否 | 是否为默认团队 |
| permission | Object | 否 | 否 | 权限配置 |

### 4. apps (应用表)

| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| _id | ObjectId | 是 | 主键 | 应用唯一标识 |
| parentId | ObjectId | 否 | 否 | 父应用ID |
| teamId | ObjectId | 是 | 是 | 团队ID |
| tmbId | ObjectId | 是 | 否 | 创建者ID |
| name | String | 是 | 否 | 应用名称 |
| type | String | 是 | 是 | 应用类型 |
| avatar | String | 否 | 否 | 应用头像 |
| intro | String | 否 | 否 | 应用介绍 |
| updateTime | Date | 否 | 是 | 更新时间 |
| modules | Array | 否 | 否 | 模块配置 |
| edges | Array | 否 | 否 | 连接配置 |
| chatConfig | Object | 否 | 否 | 聊天配置 |
| scheduledTriggerConfig | Object | 否 | 否 | 定时触发配置 |
| scheduledTriggerNextTime | Date | 否 | 否 | 下次触发时间 |
| permission | Object | 否 | 否 | 权限配置 |
| inheritPermission | Boolean | 否 | 否 | 是否继承权限 |
| defaultPermission | Object | 否 | 否 | 默认权限 |
| isPublished | Boolean | 否 | 否 | 是否已发布 |
| version | String | 否 | 否 | 版本号 |
| pluginData | Object | 否 | 否 | 插件数据 |

### 5. datasets (数据集表)

| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| _id | ObjectId | 是 | 主键 | 数据集唯一标识 |
| parentId | ObjectId | 否 | 否 | 父数据集ID |
| teamId | ObjectId | 是 | 是 | 团队ID |
| tmbId | ObjectId | 是 | 否 | 创建者ID |
| updateTime | Date | 否 | 是 | 更新时间 |
| type | String | 是 | 是 | 数据集类型 |
| status | String | 否 | 否 | 状态 |
| name | String | 是 | 否 | 数据集名称 |
| avatar | String | 否 | 否 | 头像 |
| intro | String | 否 | 否 | 介绍 |
| permission | Object | 否 | 否 | 权限 |
| vectorModel | Object | 否 | 否 | 向量模型 |
| agentModel | Object | 否 | 否 | 代理模型 |
| inheritPermission | Boolean | 否 | 否 | 是否继承权限 |
| chunkSettings | Object | 否 | 否 | 分块设置 |

### 6. chat (聊天表)

| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| _id | ObjectId | 是 | 主键 | 聊天唯一标识 |
| chatId | String | 是 | 是(唯一) | 聊天ID |
| teamId | ObjectId | 是 | 是 | 团队ID |
| tmbId | ObjectId | 是 | 是 | 团队成员ID |
| appId | ObjectId | 是 | 是 | 应用ID |
| updateTime | Date | 否 | 是 | 更新时间 |
| title | String | 否 | 否 | 聊天标题 |
| customTitle | String | 否 | 否 | 自定义标题 |
| top | Boolean | 否 | 否 | 是否置顶 |
| variables | Object | 否 | 否 | 变量 |
| source | String | 否 | 否 | 来源 |
| shareId | String | 否 | 是 | 分享ID |
| outLinkUid | String | 否 | 是 | 外链用户ID |

### 7. chatitems (聊天项表)

| 字段名 | 类型 | 必填 | 索引 | 说明 |
|--------|------|------|------|------|
| _id | ObjectId | 是 | 主键 | 聊天项唯一标识 |
| teamId | ObjectId | 是 | 否 | 团队ID |
| tmbId | ObjectId | 否 | 否 | 团队成员ID |
| chatId | String | 是 | 是 | 聊天ID |
| appId | ObjectId | 是 | 否 | 应用ID |
| time | Date | 是 | 是 | 消息时间 |
| obj | String | 是 | 否 | 消息对象(human/AI) |
| value | Array | 是 | 否 | 消息内容 |
| userGoodFeedback | String | 否 | 否 | 用户好评 |
| userBadFeedback | String | 否 | 否 | 用户差评 |
| customFeedbacks | Array | 否 | 否 | 自定义反馈 |
| adminFeedback | Object | 否 | 否 | 管理员反馈 |
| responseData | Array | 否 | 否 | 响应数据 |

## 数据库设计特点总结

1. **多租户架构**: 以团队(teams)为核心的多租户设计
2. **权限控制**: 完善的权限管理体系，支持资源级权限控制
3. **索引优化**: 针对查询场景设计了合理的索引策略
4. **数据分离**: 使用GridFS存储大文件，分离结构化和非结构化数据
5. **审计追踪**: 完整的操作日志和审计功能
6. **缓存机制**: 临时数据和缓冲表设计，提升系统性能
7. **扩展性**: 支持插件、模板等扩展功能
8. **数据完整性**: 通过外键关联保证数据一致性

## 表间关联关系图

```
users (用户)
  ├── teams (团队) [ownerId]
  ├── team_members (团队成员) [userId]
  └── promotionRecord (推广记录) [userId, objUId]

teams (团队)
  ├── team_members (团队成员) [teamId]
  ├── team_member_groups (成员组) [teamId]
  ├── team_orgs (组织) [teamId]
  ├── apps (应用) [teamId]
  ├── datasets (数据集) [teamId]
  ├── chat (聊天) [teamId]
  ├── usages (使用记录) [teamId]
  └── team_subscriptions (团队订阅) [teamId]

apps (应用)
  ├── app_versions (应用版本) [appId]
  ├── chat (聊天) [appId]
  ├── chatitems (聊天项) [appId]
  └── app_chat_logs (聊天日志) [appId]

datasets (数据集)
  ├── dataset_collections (数据集集合) [datasetId]
  ├── dataset_datas (数据集数据) [datasetId]
  └── dataset_collection_tags (集合标签) [datasetId]
```