# FastGPT MongoDB 数据库 ER 图

本文档提供了 FastGPT 项目 MongoDB 数据库的实体关系图（Entity Relationship Diagram）。

## ER 图说明

### 图例
- **实体（表）**: 矩形框表示
- **主键**: 🔑 标识
- **外键**: 🔗 标识
- **关系**: 线条连接，标注关系类型（1:1, 1:N, N:M）
- **索引**: 📊 标识重要索引字段

---

## 核心业务模块 ER 图

### 用户与团队管理模块

```mermaid
erDiagram
    users {
        ObjectId _id PK "🔑 用户ID"
        String status "用户状态"
        String username UK "📊 用户名(唯一)"
        Number phonePrefix "手机前缀"
        String password "密码"
        Date passwordUpdateTime "密码更新时间"
        Date createTime "📊 创建时间"
        Number promotionRate "推广费率"
        Object openaiAccount "OpenAI账户"
        String timezone "时区"
        ObjectId lastLoginTmbId FK "🔗 最后登录团队成员ID"
        ObjectId inviterId FK "🔗 邀请人ID"
        Object fastgpt_sem "SEM数据"
        String sourceDomain "来源域名"
        String contact "联系方式"
    }
    
    teams {
        ObjectId _id PK "🔑 团队ID"
        String name "📊 团队名称"
        ObjectId ownerId FK "🔗📊 所有者ID"
        String avatar "头像"
        Date createTime "创建时间"
        Number balance "余额"
        String teamDomain "团队域名"
        Object limit "限制配置"
        Object lafAccount "Laf账户"
        Object openaiAccount "OpenAI账户"
        Object externalWorkflowVariables "外部工作流变量"
        String notificationAccount "通知账户"
    }
    
    team_members {
        ObjectId _id PK "🔑 成员关系ID"
        ObjectId teamId FK "🔗📊 团队ID"
        ObjectId userId FK "🔗📊 用户ID"
        String avatar "成员头像"
        String name "成员名称"
        String status "成员状态"
        Date createTime "加入时间"
        Date updateTime "更新时间"
    }
    
    users ||--o{ team_members : "用户可属于多个团队"
    teams ||--o{ team_members : "团队可有多个成员"
    users ||--o| users : "邀请关系"
    users ||--o| teams : "拥有团队"
    team_members ||--o| users : "最后登录成员"
```

### 权限管理模块

```mermaid
erDiagram
    resource_permissions {
        ObjectId _id PK "🔑 权限ID"
        ObjectId teamId FK "🔗 团队ID"
        ObjectId tmbId FK "🔗 团队成员ID"
        ObjectId groupId FK "🔗 成员组ID"
        ObjectId orgId FK "🔗 组织ID"
        String resourceType "📊 资源类型"
        Number permission "权限值"
        ObjectId resourceId "📊 资源ID"
    }
    
    team_member_groups {
        ObjectId _id PK "🔑 成员组ID"
        ObjectId teamId FK "🔗 团队ID"
        String name UK "📊 组名称(团队内唯一)"
        String avatar "组头像"
        Date updateTime "更新时间"
    }
    
    orgs {
        ObjectId _id PK "🔑 组织ID"
        ObjectId teamId FK "🔗📊 团队ID"
        String pathId UK "📊 路径ID(团队内唯一)"
        String path "📊 组织路径"
        String name "组织名称"
        String avatar "组织头像"
        String description "组织描述"
        Date updateTime "更新时间"
    }
    
    teams ||--o{ resource_permissions : "团队权限"
    team_members ||--o{ resource_permissions : "成员权限"
    team_member_groups ||--o{ resource_permissions : "组权限"
    orgs ||--o{ resource_permissions : "组织权限"
    teams ||--o{ team_member_groups : "团队成员组"
    teams ||--o{ orgs : "团队组织"
```

### 应用管理模块

```mermaid
erDiagram
    apps {
        ObjectId _id PK "🔑 应用ID"
        ObjectId userId FK "🔗 用户ID(废弃)"
        ObjectId teamId FK "🔗📊 团队ID"
        ObjectId tmbId FK "🔗 创建者ID"
        String type "📊 应用类型"
        String name "应用名称"
        String avatar "应用头像"
        String intro "应用介绍"
        Date updateTime "📊 更新时间"
        Array teamTags "团队标签"
        Array modules "模块配置"
        Array edges "边配置"
        Object chatConfig "聊天配置"
        Object pluginData "插件数据"
        Object scheduledTriggerConfig "📊 定时触发配置"
        Date scheduledTriggerNextTime "📊 下次触发时间"
        Boolean inited "是否已初始化"
        Boolean inheritPermission "继承权限"
    }
    
    app_versions {
        ObjectId _id PK "🔑 版本ID"
        String tmbId FK "🔗 团队成员ID"
        ObjectId appId FK "🔗📊 应用ID"
        Date time "📊 版本时间"
        Array nodes "节点配置"
        Array edges "边配置"
        Object chatConfig "聊天配置"
        Boolean isPublish "是否发布"
        String versionName "版本名称"
    }
    
    app_templates {
        ObjectId _id PK "🔑 模板ID"
        String templateId UK "📊 模板ID"
        String name "模板名称"
        String intro "模板介绍"
        String avatar "模板头像"
        String author "作者"
        Array tags "标签列表"
        String type "模板类型"
        Boolean isActive "是否激活"
        Object userGuide "用户指南"
        Boolean isQuickTemplate "是否快速模板"
        Number order "排序"
        Object workflow "工作流配置"
    }
    
    chat_input_guides {
        ObjectId _id PK "🔑 引导ID"
        ObjectId appId FK "🔗📊 应用ID"
        String text UK "📊 引导文本(应用内唯一)"
    }
    
    teams ||--o{ apps : "团队应用"
    team_members ||--o{ apps : "创建应用"
    apps ||--o{ app_versions : "应用版本"
    apps ||--o{ chat_input_guides : "输入引导"
    team_members ||--o{ app_versions : "创建版本"
```

### 知识库管理模块

```mermaid
erDiagram
    datasets {
        ObjectId _id PK "🔑 知识库ID"
        ObjectId parentId FK "🔗 父知识库ID"
        ObjectId teamId FK "🔗📊 团队ID"
        ObjectId tmbId FK "🔗 创建者ID"
        String type "📊 知识库类型"
        String avatar "知识库头像"
        String name "知识库名称"
        Date updateTime "更新时间"
        String vectorModel "向量模型"
        String agentModel "智能体模型"
        String vlmModel "视觉语言模型"
        String intro "知识库介绍"
        Object websiteConfig "网站配置"
        Object chunkSettings "分块设置"
        Boolean inheritPermission "继承权限"
        Object apiDatasetServer "API数据集服务器"
    }
    
    dataset_collections {
        ObjectId _id PK "🔑 集合ID"
        ObjectId parentId FK "🔗 父集合ID"
        ObjectId teamId FK "🔗 团队ID"
        ObjectId tmbId FK "🔗 创建者ID"
        ObjectId datasetId FK "🔗 知识库ID"
        String type "集合类型"
        String name "集合名称"
        Array tags "标签列表"
        Date createTime "创建时间"
        Date updateTime "更新时间"
        ObjectId fileId "文件ID"
        String rawLink "原始链接"
        Object chunkSettings "分块设置"
    }
    
    dataset_datas {
        ObjectId _id PK "🔑 数据ID"
        ObjectId teamId FK "🔗 团队ID"
        ObjectId tmbId FK "🔗 创建者ID"
        ObjectId datasetId FK "🔗 知识库ID"
        ObjectId collectionId FK "🔗 集合ID"
        String q "问题内容"
        String a "答案内容"
        String imageId "图片ID"
        Object imageDescMap "图片描述映射"
        Array history "历史记录"
        Array indexes "索引信息"
    }
    
    dataset_trainings {
        ObjectId _id PK "🔑 训练ID"
        ObjectId teamId FK "🔗 团队ID"
        ObjectId tmbId FK "🔗 创建者ID"
        ObjectId datasetId FK "🔗 知识库ID"
        ObjectId collectionId FK "🔗 集合ID"
        String billId "账单ID"
        String mode "训练模式"
        Date expireAt "过期时间"
        Date lockTime "锁定时间"
    }
    
    teams ||--o{ datasets : "团队知识库"
    team_members ||--o{ datasets : "创建知识库"
    datasets ||--o{ datasets : "父子知识库"
    datasets ||--o{ dataset_collections : "知识库集合"
    dataset_collections ||--o{ dataset_collections : "父子集合"
    dataset_collections ||--o{ dataset_datas : "集合数据"
    datasets ||--o{ dataset_datas : "知识库数据"
    datasets ||--o{ dataset_trainings : "知识库训练"
    dataset_collections ||--o{ dataset_trainings : "集合训练"
```

### 聊天管理模块

```mermaid
erDiagram
    chat {
        ObjectId _id PK "🔑 会话ID"
        String chatId UK "📊 聊天ID"
        ObjectId userId FK "🔗 用户ID"
        ObjectId teamId FK "🔗 团队ID"
        ObjectId tmbId FK "🔗 团队成员ID"
        ObjectId appId FK "🔗📊 应用ID"
        Date createTime "创建时间"
        Date updateTime "📊 更新时间"
        String title "会话标题"
        String customTitle "自定义标题"
        Boolean top "📊 是否置顶"
        String source "来源类型"
        String sourceName "来源名称"
        String shareId "📊 分享ID"
        String outLinkUid "📊 外链用户ID"
        Array variableList "变量列表"
        String welcomeText "欢迎文本"
        Object variables "变量值"
        Array pluginInputs "插件输入"
        Object metadata "元数据"
        Boolean initStatistics "📊 初始化统计"
    }
    
    chatitems {
        ObjectId _id PK "🔑 消息ID"
        ObjectId teamId FK "🔗📊 团队ID"
        ObjectId tmbId FK "🔗 团队成员ID"
        ObjectId userId FK "🔗 用户ID"
        String chatId FK "🔗📊 聊天ID"
        String dataId UK "📊 数据ID"
        ObjectId appId FK "🔗📊 应用ID"
        Date time "📊 消息时间"
        Boolean hideInUI "是否在UI中隐藏"
        String obj "📊 消息角色"
        Array value "消息内容"
        Object memories "记忆信息"
        String errorMsg "错误信息"
        String userGoodFeedback "用户好评反馈"
        String userBadFeedback "用户差评反馈"
        Array customFeedbacks "自定义反馈"
        Object adminFeedback "管理员反馈"
        Array nodeResponse "节点响应"
        Number durationSeconds "持续时间(秒)"
    }
    
    apps ||--o{ chat : "应用会话"
    chat ||--o{ chatitems : "会话消息"
    teams ||--o{ chat : "团队会话"
    team_members ||--o{ chat : "成员会话"
    users ||--o{ chat : "用户会话"
    apps ||--o{ chatitems : "应用消息"
```

### 钱包与订阅模块

```mermaid
erDiagram
    usages {
        ObjectId _id PK "🔑 使用记录ID"
        ObjectId teamId FK "🔗📊 团队ID"
        ObjectId tmbId FK "🔗📊 团队成员ID"
        String source "📊 使用来源"
        String appName "📊 应用名称"
        ObjectId appId FK "🔗 应用ID"
        ObjectId pluginId FK "🔗 插件ID"
        Date time "📊 使用时间(TTL 360天)"
        Number totalPoints "总积分"
        Array list "详细列表"
    }
    
    team_subscriptions {
        ObjectId _id PK "🔑 订阅ID"
        ObjectId teamId FK "🔗📊 团队ID"
        String type "📊 订阅类型"
        Date startTime "开始时间"
        Date expiredTime "📊 过期时间"
        String currentMode "当前模式"
        String nextMode "下个模式"
        String currentSubLevel "📊 当前订阅级别"
        String nextSubLevel "下个订阅级别"
        Number maxTeamMember "最大团队成员数"
        Number maxApp "最大应用数"
        Number maxDataset "最大知识库数"
        Number totalPoints "总积分"
        Number surplusPoints "剩余积分"
        Number currentExtraDatasetSize "当前额外数据集大小"
    }
    
    team_sub_coupons {
        ObjectId _id PK "🔑 优惠券ID"
        String key UK "📊 优惠券密钥"
        String type "优惠券类型"
        Number price "价格"
        String description "描述"
        Array subscriptions "订阅配置"
        Date redeemedAt "兑换时间"
        ObjectId redeemedTeamId FK "🔗 兑换团队ID"
        Date expiredAt "过期时间"
    }
    
    teams ||--o{ usages : "团队使用记录"
    team_members ||--o{ usages : "成员使用记录"
    apps ||--o{ usages : "应用使用记录"
    teams ||--o{ team_subscriptions : "团队订阅"
    teams ||--o{ team_sub_coupons : "团队优惠券"
```

### 系统管理模块

```mermaid
erDiagram
    systemConfigs {
        ObjectId _id PK "🔑 配置ID"
        String type UK "📊 配置类型"
        Object value "配置值"
        Date createTime "创建时间"
    }
    
    system_models {
        ObjectId _id PK "🔑 模型ID"
        String model UK "📊 模型名称"
        Object metadata "模型元数据"
    }
    
    system_logs {
        ObjectId _id PK "🔑 日志ID"
        String text "日志内容"
        String level "📊 日志级别"
        Date time "📊 日志时间(TTL 15天)"
        Object metadata "元数据"
    }
    
    openapi {
        ObjectId _id PK "🔑 API密钥ID"
        ObjectId teamId FK "🔗📊 团队ID"
        ObjectId tmbId FK "🔗 团队成员ID"
        String apiKey UK "📊 API密钥"
        Date createTime "创建时间"
        Date lastUsedTime "最后使用时间"
        String appId "应用ID"
        String name "密钥名称"
        Number usagePoints "使用积分"
        Object limit "限制配置"
    }
    
    teams ||--o{ openapi : "团队API密钥"
    team_members ||--o{ openapi : "成员API密钥"
```

### 文件存储模块

```mermaid
erDiagram
    dataset_files {
        ObjectId _id PK "🔑 文件ID"
        Object metadata "文件元数据"
        Date uploadDate "📊 上传时间"
    }
    
    chat_files {
        ObjectId _id PK "🔑 文件ID"
        Object metadata "文件元数据"
        Date uploadDate "📊 上传时间"
    }
    
    dataset_image_files {
        ObjectId _id PK "🔑 图片ID"
        Number length "文件大小"
        Number chunkSize "块大小"
        Date uploadDate "上传时间"
        String filename "文件名"
        String contentType "内容类型"
        Object metadata "📊 元数据(多索引)"
    }
    
    buffer_rawtext_files {
        ObjectId _id PK "🔑 缓存ID"
        Object metadata "📊 元数据(多索引)"
    }
    
    tmp_datas {
        ObjectId _id PK "🔑 临时数据ID"
        String dataId UK "📊 数据ID"
        Object data "数据内容"
        Date expireAt "📊 过期时间(TTL 5秒)"
    }
```

---

## 完整系统 ER 图概览

```mermaid
erDiagram
    %% 核心用户管理
    users {
        ObjectId _id PK
        String username UK
        ObjectId lastLoginTmbId FK
        ObjectId inviterId FK
    }
    
    teams {
        ObjectId _id PK
        String name
        ObjectId ownerId FK
    }
    
    team_members {
        ObjectId _id PK
        ObjectId teamId FK
        ObjectId userId FK
    }
    
    %% 权限管理
    resource_permissions {
        ObjectId _id PK
        ObjectId teamId FK
        ObjectId tmbId FK
        String resourceType
        ObjectId resourceId
    }
    
    %% 应用管理
    apps {
        ObjectId _id PK
        ObjectId teamId FK
        ObjectId tmbId FK
        String type
    }
    
    %% 知识库管理
    datasets {
        ObjectId _id PK
        ObjectId teamId FK
        ObjectId tmbId FK
        ObjectId parentId FK
    }
    
    dataset_collections {
        ObjectId _id PK
        ObjectId datasetId FK
        ObjectId parentId FK
    }
    
    dataset_datas {
        ObjectId _id PK
        ObjectId datasetId FK
        ObjectId collectionId FK
    }
    
    %% 聊天管理
    chat {
        ObjectId _id PK
        String chatId UK
        ObjectId appId FK
        ObjectId teamId FK
    }
    
    chatitems {
        ObjectId _id PK
        String chatId FK
        ObjectId appId FK
        ObjectId teamId FK
    }
    
    %% 订阅计费
    usages {
        ObjectId _id PK
        ObjectId teamId FK
        ObjectId appId FK
    }
    
    team_subscriptions {
        ObjectId _id PK
        ObjectId teamId FK
    }
    
    %% 关系定义
    users ||--o{ team_members : "用户-团队成员"
    teams ||--o{ team_members : "团队-成员"
    users ||--o| teams : "拥有团队"
    
    teams ||--o{ resource_permissions : "团队权限"
    team_members ||--o{ resource_permissions : "成员权限"
    
    teams ||--o{ apps : "团队应用"
    team_members ||--o{ apps : "创建应用"
    
    teams ||--o{ datasets : "团队知识库"
    datasets ||--o{ dataset_collections : "知识库集合"
    dataset_collections ||--o{ dataset_datas : "集合数据"
    
    apps ||--o{ chat : "应用会话"
    chat ||--o{ chatitems : "会话消息"
    
    teams ||--o{ usages : "团队使用"
    teams ||--o{ team_subscriptions : "团队订阅"
```

---

## 关系类型说明

### 一对一关系 (1:1)
- `users.lastLoginTmbId` → `team_members._id`
- `teams.ownerId` → `users._id`

### 一对多关系 (1:N)
- `teams` → `team_members` (一个团队有多个成员)
- `users` → `team_members` (一个用户可以是多个团队的成员)
- `datasets` → `dataset_collections` (一个知识库有多个集合)
- `dataset_collections` → `dataset_datas` (一个集合有多个数据)
- `apps` → `chat` (一个应用有多个聊天会话)
- `chat` → `chatitems` (一个会话有多个消息)

### 多对多关系 (N:M)
- `users` ↔ `teams` (通过 `team_members` 中间表)
- `resource_permissions` 连接多个实体的权限关系

### 自引用关系
- `users.inviterId` → `users._id` (用户邀请关系)
- `datasets.parentId` → `datasets._id` (知识库父子关系)
- `dataset_collections.parentId` → `dataset_collections._id` (集合父子关系)

---

## 索引策略总结

### 主键索引
所有表的 `_id` 字段都是主键索引

### 唯一索引
- `users.username` - 用户名唯一
- `system_models.model` - 模型名称唯一
- `systemConfigs.type` - 配置类型唯一
- `team_sub_coupons.key` - 优惠券密钥唯一
- `tmp_datas.dataId` - 临时数据ID唯一

### 复合索引
- `(teamId, updateTime)` - 团队相关的时间查询
- `(appId, chatId)` - 应用聊天查询
- `(teamId, resourceType, resourceId)` - 权限查询
- `(teamId, name)` - 团队内名称唯一性

### TTL索引（自动过期）
- `system_logs.time` - 15天后自动删除
- `usages.time` - 360天后自动删除
- `tmp_datas.expireAt` - 5秒后自动删除

---

## 数据完整性约束

### 外键约束
1. **用户相关**:
   - `team_members.userId` → `users._id`
   - `team_members.teamId` → `teams._id`
   - `teams.ownerId` → `users._id`

2. **应用相关**:
   - `apps.teamId` → `teams._id`
   - `apps.tmbId` → `team_members._id`
   - `chat.appId` → `apps._id`
   - `chatitems.appId` → `apps._id`

3. **知识库相关**:
   - `datasets.teamId` → `teams._id`
   - `dataset_collections.datasetId` → `datasets._id`
   - `dataset_datas.datasetId` → `datasets._id`
   - `dataset_datas.collectionId` → `dataset_collections._id`

4. **权限相关**:
   - `resource_permissions.teamId` → `teams._id`
   - `resource_permissions.tmbId` → `team_members._id`

### 业务规则约束
1. **团队成员唯一性**: 同一用户在同一团队中只能有一个成员记录
2. **权限继承**: 子资源可以继承父资源的权限设置
3. **软删除**: 重要数据采用状态标记而非物理删除
4. **数据归属**: 所有业务数据都必须归属于某个团队

---

## 性能优化建议

### 查询优化
1. **分页查询**: 使用 `limit` 和 `skip` 进行分页
2. **投影查询**: 只查询需要的字段，减少网络传输
3. **聚合管道**: 使用 MongoDB 聚合框架进行复杂查询

### 索引优化
1. **复合索引顺序**: 根据查询频率和选择性排序
2. **稀疏索引**: 对可选字段使用稀疏索引
3. **部分索引**: 对特定条件的文档建立索引

### 数据分片
1. **按团队分片**: 以 `teamId` 作为分片键
2. **按时间分片**: 对时序数据按时间分片
3. **按地理位置分片**: 对全球部署按地区分片

这个 ER 图展示了 FastGPT 系统完整的数据库设计，包括所有表的结构、关系和约束，为系统的开发、维护和优化提供了重要参考。