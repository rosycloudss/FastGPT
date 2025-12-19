# FastGPT 数据集过滤逻辑详解

## 概览

FastGPT 的数据集过滤主要包括两个核心功能：
1. **数据集标签管理和过滤** - 基于标签对集合(Collection)进行分类和过滤
2. **集合过滤** - 在搜索和查询时根据多种条件过滤集合

---

## 一、数据集标签系统架构

### 1.1 数据结构

#### 标签 Schema (Tags)
**文件**: [packages/service/core/dataset/tag/schema.ts](packages/service/core/dataset/tag/schema.ts)

```typescript
// 标签存储结构
DatasetCollectionTagsSchema: {
  teamId: ObjectId,           // 团队ID
  datasetId: ObjectId,        // 数据集ID
  tag: String                 // 标签内容
}

// 索引
Index: { teamId: 1, datasetId: 1, tag: 1 }
```

#### 集合 Schema (Collection)
集合的标签存储为 ID 数组：
```typescript
MongoDatasetCollection: {
  // ...其他字段
  tags: String[],            // 标签ID数组
  // ...
}
```

### 1.2 标签类型定义

**文件**: `packages/global/core/dataset/type.d.ts`

```typescript
export type DatasetTagType = {
  _id: string;              // 标签ID
  tag: string;              // 标签名称
  teamId: string;
  datasetId: string;
};

export type TagUsageType = {
  tagId: string;
  collections: string[];    // 使用此标签的集合列表
};
```

---

## 二、标签管理流程

### 2.1 创建标签
**API**: `POST /proApi/core/dataset/tag/create`

**参数类型** [packages/global/core/dataset/api.d.ts](packages/global/core/dataset/api.d.ts):
```typescript
export type CreateDatasetCollectionTagParams = {
  datasetId: string;
  tag: string;
};
```

**后端实现** (远程 Pro 版本服务):
1. 验证数据集权限
2. 检查标签是否已存在
3. 创建标签记录到 `MongoDatasetCollectionTags`

### 2.2 添加标签到集合
**API**: `POST /proApi/core/dataset/tag/addToCollections`

**参数类型**:
```typescript
export type AddTagsToCollectionsParams = {
  originCollectionIds: string[];   // 原有标签对应的集合
  collectionIds: string[];         // 新增标签对应的集合
  datasetId: string;
  tag: string;                     // 标签名称
};
```

**实现流程**:
1. 通过标签名称查询或创建标签
2. 更新集合的 tags 字段
3. 支持从一些集合移除，从另一些集合添加

### 2.3 更新标签
**API**: `POST /proApi/core/dataset/tag/update`

**参数类型**:
```typescript
export type UpdateDatasetCollectionTagParams = {
  datasetId: string;
  tagId: string;
  tag: string;              // 新的标签名称
};
```

### 2.4 删除标签
**API**: `DELETE /proApi/core/dataset/tag/delete`

删除标签同时需要从所有集合中移除对该标签的引用。

---

## 三、集合列表过滤逻辑

### 3.1 基础列表查询接口

#### V2 版本 (标准)
**文件**: [projects/app/src/pages/api/core/dataset/collection/listV2.ts](projects/app/src/pages/api/core/dataset/collection/listV2.ts)

```typescript
// 请求参数
type GetDatasetCollectionsProps = {
  datasetId: string;
  parentId?: string | null;
  searchText?: string;
  selectFolder?: boolean;
  filterTags?: string[];      // 需要包含的标签 ID 数组
  simple?: boolean;           // 是否返回简化数据
};

// MongoDB 查询条件构建
const match = {
  teamId: ObjectId(teamId),
  datasetId: ObjectId(datasetId),
  ...(selectFolder ? { type: DatasetCollectionTypeEnum.folder } : {}),
  ...(searchText ? { name: new RegExp(searchText, 'i') } : { parentId: ... }),
  ...(filterTags.length ? { tags: { $in: filterTags } } : {})
  //                        ^^^^^^ 集合的 tags 字段包含至少一个指定的标签
};
```

**过滤逻辑**:
- `tags: { $in: filterTags }` - 集合必须包含 filterTags 中的**至少一个**标签

#### Scroll 版本 (页面滚动加载)
**文件**: [projects/app/src/pages/api/core/dataset/collection/scrollList.ts](projects/app/src/pages/api/core/dataset/collection/scrollList.ts)

```typescript
// 相同参数
type GetScrollCollectionsProps = PaginationProps<{
  datasetId: string;
  parentId?: string | null;
  searchText?: string;
  selectFolder?: boolean;
  filterTags?: string[];
  simple?: boolean;
}>;

// 区别: 使用 $all 操作符 (AND 逻辑)
const match = {
  // ...
  ...(filterTags.length ? { tags: { $all: filterTags } } : {})
  //                        ^^^^^^ 集合必须包含所有指定的标签
};
```

**过滤逻辑**:
- `tags: { $all: filterTags }` - 集合必须包含 filterTags 中的**所有**标签

### 3.2 搜索时的高级过滤

**文件**: [packages/service/core/dataset/search/controller.ts](packages/service/core/dataset/search/controller.ts)

搜索时支持更复杂的标签和集合过滤逻辑（高级功能，仅 Plus 版本）。

#### 过滤参数解析
```typescript
// 支持 JSON5 格式的过滤条件
type CollectionFilterMatch = {
  tags?: {
    $and?: (string | null)[];    // AND 逻辑：包含所有这些标签 (或无标签)
    $or?: (string | null)[];     // OR 逻辑：包含至少一个这些标签 (或无标签)
  };
  createTime?: {
    $gte?: string;               // 创建时间范围
    $lte?: string;
  };
};
```

#### $and 标签过滤 (AND 逻辑)
```typescript
// 获取匹配所有指定标签的集合
if (andTags && andTags.length > 0) {
  const uniqueAndTags = Array.from(new Set(andTags));
  
  // 特殊情况：同时指定 null 和字符串标签 -> 返回空
  if (uniqueAndTags.includes(null) && uniqueAndTags.some(tag => typeof tag === 'string')) {
    return [];  // 无法既有标签又无标签
  }
  
  // 情况 1: 所有都是字符串标签
  if (uniqueAndTags.every(tag => typeof tag === 'string')) {
    // 1. 查询标签表获取标签 ID
    const matchedTags = await MongoDatasetCollectionTags.find({
      teamId,
      datasetId: { $in: datasetIds },
      tag: { $in: uniqueAndTags }
    }).lean();
    
    // 2. 按数据集分组标签
    const datasetTagMap = new Map<string, {
      tagIds: string[];
      tagNames: Set<string>
    }>();
    
    matchedTags.forEach(tag => {
      if (!datasetTagMap.has(tag.datasetId)) {
        datasetTagMap.set(tag.datasetId, { tagIds: [], tagNames: new Set() });
      }
      const data = datasetTagMap.get(tag.datasetId)!;
      data.tagIds.push(tag._id);
      data.tagNames.add(tag.tag);
    });
    
    // 3. 过滤出包含所有指定标签的数据集
    const validDatasetIds = Array.from(datasetTagMap.entries())
      .filter(([_, data]) => 
        uniqueAndTags.every(tag => data.tagNames.has(tag as string))
      )
      .map(([datasetId]) => datasetId);
    
    // 4. 获取在这些数据集中同时具有所有标签 ID 的集合
    const collectionsPromises = validDatasetIds.map(datasetId => {
      const { tagIds } = datasetTagMap.get(datasetId)!;
      return MongoDatasetCollection.find({
        teamId,
        datasetId,
        tags: { $all: tagIds }  // 必须包含所有这些标签
      }, '_id').lean();
    });
    
    const collectionsResults = await Promise.all(collectionsPromises);
    tagCollectionIdList = collectionsResults.flat().map(item => String(item._id));
  }
  
  // 情况 2: 所有都是 null (无标签)
  else if (uniqueAndTags.every(tag => tag === null)) {
    const collections = await MongoDatasetCollection.find({
      teamId,
      datasetId: { $in: datasetIds },
      $or: [
        { tags: { $size: 0 } },      // 标签数组为空
        { tags: { $exists: false } }  // 不存在 tags 字段
      ]
    }, '_id').lean();
    
    tagCollectionIdList = collections.map(item => String(item._id));
  }
}
```

#### $or 标签过滤 (OR 逻辑)
```typescript
else if (orTags && orTags.length > 0) {
  // 获取所有匹配的标签 ID
  const orTagArray = await MongoDatasetCollectionTags.find({
    teamId,
    datasetId: { $in: datasetIds },
    tag: { $in: orTags.filter(tag => tag !== null) }
  }, '_id').lean();
  
  const orTagIds = orTagArray.map(item => String(item._id));
  
  // 获取包含任意一个这些标签 ID 的集合
  const collections = await MongoDatasetCollection.find({
    teamId,
    datasetId: { $in: datasetIds },
    $or: [
      { tags: { $in: orTagIds } },
      ...(orTags.includes(null) ? [{ tags: { $size: 0 } }] : [])
    ]
  }, '_id').lean();
  
  tagCollectionIdList = collections.map(item => String(item._id));
}
```

#### 创建时间过滤
```typescript
const getCreateTime = jsonMatch?.createTime?.$gte as string | undefined;
const lteCreateTime = jsonMatch?.createTime?.$lte as string | undefined;

if (getCreateTime || lteCreateTime) {
  const collections = await MongoDatasetCollection.find({
    teamId,
    datasetId: { $in: datasetIds },
    createTime: {
      ...(getCreateTime && { $gte: new Date(getCreateTime) }),
      ...(lteCreateTime && { $lte: new Date(lteCreateTime) })
    }
  }, '_id');
  
  createTimeCollectionIdList = collections.map(item => String(item._id));
}
```

---

## 四、前端 UI 实现

### 4.1 标签上下文管理
**文件**: [projects/app/src/web/core/dataset/context/datasetPageContext.tsx](projects/app/src/web/core/dataset/context/datasetPageContext.tsx)

```typescript
type DatasetPageContextType = {
  // 搜索结果
  searchDatasetTagsResult: DatasetTagType[];
  
  // 所有标签
  allDatasetTags: DatasetTagType[];
  loadAllDatasetTags: () => Promise<DatasetTagType[]>;
  
  // 已选中的标签
  checkedDatasetTag: DatasetTagType[];
  setCheckedDatasetTag: React.Dispatch<SetStateAction<DatasetTagType[]>>;
  
  // 创建新标签
  onCreateCollectionTag: (tag: string) => Promise<void>;
  isCreateCollectionTagLoading: boolean;
  
  // 搜索关键字
  searchTagKey: string;
  setSearchTagKey: Dispatch<SetStateAction<string>>;
};
```

### 4.2 标签过滤组件
**文件**: [projects/app/src/pageComponents/dataset/detail/CollectionCard/HeaderTagPopOver.tsx](projects/app/src/pageComponents/dataset/detail/CollectionCard/HeaderTagPopOver.tsx)

```typescript
// 标签选中逻辑
const checkTags = (tag: DatasetTagType) => {
  let currentCheckedTags = [];
  
  if (checkedTags.includes(tag._id)) {
    // 取消选中：移除该标签 ID
    currentCheckedTags = checkedTags.filter((t) => t !== tag._id);
    setCheckedDatasetTag(checkedDatasetTag.filter((t) => t._id !== tag._id));
  } else {
    // 选中：添加该标签 ID
    currentCheckedTags = [...checkedTags, tag._id];
    setCheckedDatasetTag([...checkedDatasetTag, tag]);
  }
  
  // 如果过滤标签没有变化则不更新
  if (isEqual(currentCheckedTags, filterTags)) return;
  
  // 更新过滤条件并重新获取数据
  setFilterTags(currentCheckedTags);
};
```

### 4.3 集合列表上下文
**文件**: [projects/app/src/pageComponents/dataset/detail/CollectionCard/Context.tsx](projects/app/src/pageComponents/dataset/detail/CollectionCard/Context.tsx)

```typescript
type CollectionPageContextType = {
  filterTags: string[];              // 选中的标签 ID 数组
  setFilterTags: (tags: string[]) => void;
  getData: (pageNum?: number) => void;  // 重新加载集合列表
};
```

### 4.4 标签管理模态框
**文件**: [projects/app/src/pageComponents/dataset/detail/CollectionCard/TagManageModal.tsx](projects/app/src/pageComponents/dataset/detail/CollectionCard/TagManageModal.tsx)

**功能**:
1. 显示所有标签及其使用情况
2. 创建新标签
3. 编辑标签名称
4. 删除标签
5. 添加/移除标签到/从集合

```typescript
// 添加标签到集合
const onSaveCollectionTag = useRequest2(
  async ({
    tag,
    originCollectionIds,      // 原有使用此标签的集合
    collectionIds             // 新增使用此标签的集合
  }) => {
    return postAddTagsToCollections({
      tag,
      originCollectionIds,
      collectionIds,
      datasetId: datasetDetail._id
    });
  }
);
```

---

## 五、关键数据流

### 5.1 标签过滤流程

```
用户在 UI 选择标签
    ↓
HeaderTagPopOver.checkTags()
    ↓
setFilterTags(selectedTagIds)  // 更新上下文
    ↓
CollectionPageContext.getData()
    ↓
GET /core/dataset/collection/listV2
  (或 scrollList)
    ↓
后端构建 MongoDB 查询:
  match = { tags: { $in: filterTags } }
    ↓
返回符合条件的集合列表
    ↓
前端更新集合显示
```

### 5.2 搜索时的高级过滤

```
搜索请求包含 collectionFilterMatch 参数
    ↓
searchDatasetData() 解析过滤条件
    ↓
根据过滤类型执行不同的逻辑:
  - $and: 查询必须包含所有标签的集合
  - $or: 查询包含任意一个标签的集合
  - createTime: 按创建时间过滤
    ↓
将结果合并到搜索查询
    ↓
返回同时满足向量相似度和集合过滤的结果
```

---

## 六、关键特性

### 6.1 标签查询操作符对比

| 操作符 | 查询例子 | 含义 | MongoDB 操作符 |
|--------|---------|------|---|
| $in | `{ $in: [tag1, tag2] }` | 包含至少一个 | `$in` |
| $all | `{ $all: [tag1, tag2] }` | 包含所有 | `$all` |
| $or | `{ $or: [{...}, {...}] }` | 逻辑或 | `$or` |

### 6.2 标签特殊值

- `null` - 表示"无标签"的集合
- 可以同时指定 null 和具体标签名来混合过滤

### 6.3 权限验证

所有标签操作都需要经过权限验证：
- 创建/编辑/删除标签需要数据集的 **写入权限**
- 查询集合需要数据集的 **读取权限**

---

## 七、API 调用汇总

**文件**: [projects/app/src/web/core/dataset/api.ts](projects/app/src/web/core/dataset/api.ts)

### 标签管理 APIs

```typescript
// 创建标签
export const postCreateDatasetCollectionTag = (data: CreateDatasetCollectionTagParams) =>
  POST(`/proApi/core/dataset/tag/create`, data);

// 添加标签到集合
export const postAddTagsToCollections = (data: AddTagsToCollectionsParams) =>
  POST(`/proApi/core/dataset/tag/addToCollections`, data);

// 删除标签
export const delDatasetCollectionTag = (data: { id: string; datasetId: string }) =>
  DELETE(`/proApi/core/dataset/tag/delete`, data);

// 更新标签
export const updateDatasetCollectionTag = (data: UpdateDatasetCollectionTagParams) =>
  POST(`/proApi/core/dataset/tag/update`, data);

// 获取标签列表
export const getDatasetCollectionTags = (
  data: PaginationProps<{ datasetId: string; searchText?: string }>
) => POST<PaginationResponse<DatasetTagType>>(`/proApi/core/dataset/tag/list`, data);

// 获取标签使用情况
export const getTagUsage = (datasetId: string) =>
  GET<TagUsageType[]>(`/proApi/core/dataset/tag/tagUsage?datasetId=${datasetId}`);

// 获取所有标签
export const getAllTags = (datasetId: string) =>
  GET<{ list: DatasetTagType[] }>(`/proApi/core/dataset/tag/getAllTags?datasetId=${datasetId}`);
```

### 集合列表 APIs

```typescript
// 获取集合列表 (V2)
export const getDatasetCollections = (data: GetDatasetCollectionsProps) =>
  POST<PaginationResponse<DatasetCollectionsListItemType>>(`/core/dataset/collection/listV2`, data);

// 获取集合列表 (Scroll)
export const getDatasetCollections = (data: GetScrollCollectionsProps) =>
  POST<PaginationResponse<DatasetCollectionsListItemType>>(`/core/dataset/collection/scrollList`, data);
```

---

## 八、代码位置导航

| 功能模块 | 文件位置 |
|--------|--------|
| 标签 Schema | `packages/service/core/dataset/tag/schema.ts` |
| 标签工具函数 | `packages/service/core/dataset/collection/utils.ts` |
| 搜索过滤逻辑 | `packages/service/core/dataset/search/controller.ts` (第 298-430 行) |
| 集合列表 API V2 | `projects/app/src/pages/api/core/dataset/collection/listV2.ts` |
| 集合列表 API Scroll | `projects/app/src/pages/api/core/dataset/collection/scrollList.ts` |
| 前端标签上下文 | `projects/app/src/web/core/dataset/context/datasetPageContext.tsx` |
| 标签过滤 UI | `projects/app/src/pageComponents/dataset/detail/CollectionCard/HeaderTagPopOver.tsx` |
| 标签管理 UI | `projects/app/src/pageComponents/dataset/detail/CollectionCard/TagManageModal.tsx` |
| 集合上下文 | `projects/app/src/pageComponents/dataset/detail/CollectionCard/Context.tsx` |
| API 定义 | `projects/app/src/web/core/dataset/api.ts` |
| 类型定义 | `packages/global/core/dataset/api.d.ts` |

