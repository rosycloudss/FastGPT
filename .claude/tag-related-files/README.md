# FastGPT 标签系统相关代码文件

此目录包含所有与数据集标签系统相关的代码文件，按照功能模块分类。

## 📂 目录结构

### 🔧 Backend (后端文件)
- **01-tag-schema.ts** - MongoDB 标签 Schema 定义
  - `MongoDatasetCollectionTags` 模型
  - 标签表结构和索引
  
- **02-collection-utils.ts** - 集合工具函数
  - `createOrGetCollectionTags()` - 创建或获取标签
  - `collectionTagsToTagLabel()` - 标签ID转换为标签名称
  - 其他集合相关的工具函数
  
- **03-search-controller.ts** - 搜索控制器（高级过滤逻辑）
  - `searchDatasetData()` - 搜索数据集数据
  - 标签高级过滤实现（$and, $or, 时间范围等）
  - 仅 Plus 版本支持
  
- **04-collection-listV2-api.ts** - 集合列表 API V2
  - `handler()` - 获取集合列表
  - 使用 `$in` 操作符（OR 逻辑）过滤标签
  - 标准分页查询
  
- **05-collection-scrollList-api.ts** - 集合列表滚动加载 API
  - `handler()` - 滚动分页获取集合
  - 使用 `$all` 操作符（AND 逻辑）过滤标签
  - 无限滚动加载

### 🎨 Frontend (前端文件)
- **01-dataset-api.ts** - 数据集 API 调用
  - `postCreateDatasetCollectionTag()` - 创建标签
  - `postAddTagsToCollections()` - 添加标签到集合
  - `delDatasetCollectionTag()` - 删除标签
  - `updateDatasetCollectionTag()` - 更新标签
  - `getDatasetCollectionTags()` - 获取标签列表
  - `getTagUsage()` - 获取标签使用情况
  - `getAllTags()` - 获取所有标签
  
- **02-datasetPageContext.tsx** - 数据集页面上下文
  - 管理所有标签相关的全局状态
  - `searchDatasetTagsResult` - 搜索结果
  - `allDatasetTags` - 所有标签列表
  - `checkedDatasetTag` - 选中的标签
  - 标签搜索和创建逻辑
  
- **03-HeaderTagPopOver.tsx** - 标签过滤弹出框
  - 标签选择 UI 组件
  - `checkTags()` - 标签选中/取消逻辑
  - 支持快速搜索和创建新标签
  
- **04-TagManageModal.tsx** - 标签管理模态框
  - 完整的标签管理界面
  - 创建、编辑、删除标签
  - 为集合添加/移除标签
  - 显示标签使用情况
  
- **05-CollectionPageContext.tsx** - 集合列表页面上下文
  - 管理集合列表过滤状态
  - `filterTags` - 选中的过滤标签
  - `setFilterTags()` - 更新过滤条件
  - `getData()` - 重新加载集合列表

### 📋 Types (类型定义)
- **01-dataset-api-types.ts** - API 参数类型
  - `CreateDatasetCollectionTagParams` - 创建标签参数
  - `AddTagsToCollectionsParams` - 添加标签参数
  - `UpdateDatasetCollectionTagParams` - 更新标签参数
  
- **02-dataset-types.ts** - 数据类型定义
  - `DatasetTagType` - 标签类型
  - `TagUsageType` - 标签使用情况类型
  - `DatasetCollectionTagsSchemaType` - 标签 Schema 类型

## 🔄 数据流

### 标签过滤流程
```
用户选择标签
    ↓
HeaderTagPopOver.checkTags()
    ↓
CollectionPageContext.setFilterTags()
    ↓
collectionPageContext.getData()
    ↓
API: /core/dataset/collection/listV2 (或 scrollList)
    ↓
后端：MongoDB 查询 { tags: { $in: filterTags } }
    ↓
返回符合条件的集合列表
    ↓
前端更新显示
```

### 标签管理流程
```
TagManageModal 显示所有标签
    ↓
用户创建/编辑/删除标签
    ↓
调用相应的 API
    ↓
后端处理并更新 MongoDatasetCollectionTags
    ↓
刷新标签列表
```

## 🔑 关键概念

### MongoDB 查询操作符
- `$in` - 包含至少一个元素（OR 逻辑）
  - 使用于：listV2 API
  - 查询：`{ tags: { $in: filterTags } }`
  
- `$all` - 包含所有元素（AND 逻辑）
  - 使用于：scrollList API
  - 查询：`{ tags: { $all: filterTags } }`

### 高级过滤（Pro 版本）
- `$and` - AND 逻辑，需要包含所有指定标签
- `$or` - OR 逻辑，包含至少一个指定标签
- 支持 `null` 表示"无标签"的集合
- 支持创建时间范围过滤

## 📍 原始文件位置

| 文件 | 原始路径 |
|------|--------|
| Tag Schema | `packages/service/core/dataset/tag/schema.ts` |
| Collection Utils | `packages/service/core/dataset/collection/utils.ts` |
| Search Controller | `packages/service/core/dataset/search/controller.ts` |
| ListV2 API | `projects/app/src/pages/api/core/dataset/collection/listV2.ts` |
| ScrollList API | `projects/app/src/pages/api/core/dataset/collection/scrollList.ts` |
| Dataset API | `projects/app/src/web/core/dataset/api.ts` |
| Dataset Context | `projects/app/src/web/core/dataset/context/datasetPageContext.tsx` |
| Header Tag PopOver | `projects/app/src/pageComponents/dataset/detail/CollectionCard/HeaderTagPopOver.tsx` |
| Tag Manage Modal | `projects/app/src/pageComponents/dataset/detail/CollectionCard/TagManageModal.tsx` |
| Collection Context | `projects/app/src/pageComponents/dataset/detail/CollectionCard/Context.tsx` |
| API Types | `packages/global/core/dataset/api.d.ts` |
| Dataset Types | `packages/global/core/dataset/type.d.ts` |

## 🎯 使用场景

- **学习标签系统架构** - 了解完整的实现流程
- **功能扩展** - 在此基础上添加新的标签功能
- **bug 修复** - 快速定位标签相关的问题
- **性能优化** - 分析和改进标签查询性能
- **代码审查** - 集中审查标签相关代码

## 📝 注意事项

1. **Pro 版本限制** - 高级过滤（$and/$or）仅在 Pro 版本可用，需要检查 `global.feConfigs.isPlus`
2. **权限验证** - 所有操作需要经过权限验证
3. **性能考虑** - 标签查询使用了复合索引 `{ teamId: 1, datasetId: 1, tag: 1 }`
4. **API 代理** - 标签相关 API 通过 `/proApi/[...path].ts` 代理到远程服务

---

生成于: 2025-12-19
