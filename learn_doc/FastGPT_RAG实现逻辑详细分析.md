# FastGPT RAG实现逻辑详细分析

## 概述

本文档基于FastGPT源代码深入分析其RAG（Retrieval-Augmented Generation）实现逻辑，涵盖数据处理、向量化、检索、生成等各个阶段的技术实现。

## 1. RAG架构概览

FastGPT的RAG实现采用工作流引擎驱动的模块化架构，主要包含以下核心组件：

- **工作流引擎**：负责节点调度和数据流转
- **数据集模块**：处理知识库数据的导入、存储和管理
- **检索模块**：实现向量检索和全文检索
- **生成模块**：基于检索结果生成回答

## 2. 数据处理阶段

### 2.1 数据导入与预处理

**核心文件**：`packages/service/core/dataset/training/controller.ts`

**主要功能**：
- 文档解析和分块处理
- 数据清洗和格式化
- 元数据提取和存储

**关键实现**：
```typescript
// 数据训练队列处理
export async function pushDataListToTrainingQueue({
  teamId,
  tmbId,
  datasetId,
  collectionId,
  agentModel,
  vectorModel,
  vlmModel,
  data,
  billId,
  mode = TrainingModeEnum.chunk,
  indexSize,
  session
}: PushDataToTrainingQueueProps): Promise<PushDatasetDataResponse> {
  // 1. 数据验证和预处理
  // 2. 批量插入到训练队列
  // 3. 返回插入结果
}
```

### 2.2 向量化处理

**核心文件**：`packages/service/core/ai/embedding/index.ts`

**技术栈**：
- 支持多种embedding模型（OpenAI、本地模型等）
- 批量向量化处理
- 向量维度管理

**关键实现**：
```typescript
// 向量化处理
export async function getVectorsByText({ model, input, type, headers }: GetVectorProps) {
  if (!input) {
    return Promise.reject({
      code: 500,
      message: 'input is empty'
    });
  }
  const ai = getAIApi();
  const formatInput = Array.isArray(input) ? input : [input];
  
  // 20 size every request - 批量处理优化
  const chunkSize = 20;
  const chunks = [];
  for (let i = 0; i < formatInput.length; i += chunkSize) {
    chunks.push(formatInput.slice(i, i + chunkSize));
  }
  
  // 处理每个批次并返回向量结果
  // ...
}
```

### 2.3 数据存储

**存储架构**：
- **PostgreSQL**：存储结构化数据和元数据
- **PgVector**：存储向量数据，支持向量相似度搜索
- **MongoDB**：存储非结构化数据

**核心文件**：`packages/service/common/vectorDB/pg/index.ts`

## 3. 检索阶段

### 3.1 检索控制器

**核心文件**：`packages/service/core/dataset/search/controller.ts`

**主要功能**：
- 混合检索策略（向量检索 + 全文检索）
- 结果合并和排序
- 相关性过滤

### 3.2 向量检索实现

**关键函数**：`embeddingRecall`

**实现逻辑**：
```typescript
const embeddingRecall = async ({
  queries,
  limit,
  forbidCollectionIdList,
  filterCollectionIdList
}: {
  queries: string[];
  limit: number;
  forbidCollectionIdList: string[];
  filterCollectionIdList?: string[];
}): Promise<{
  embeddingRecallResults: SearchDataResponseItemType[][];
  tokens: number;
}> => {
  // 1. 查询向量化
  const { vectors, tokens } = await getVectorsByText({
    model: getEmbeddingModel(model),
    input: queries,
    type: 'query'
  });
  
  // 2. 向量数据库检索
  const recallResults = await Promise.all(
    vectors.map(async (vector) => {
      return await recallFromVectorStore({
        teamId,
        datasetIds,
        vector,
        limit,
        forbidCollectionIdList,
        filterCollectionIdList
      });
    })
  );
  
  // 3. 结果处理和返回
  return { embeddingRecallResults: recallResults, tokens };
};
```

### 3.3 全文检索实现

**关键函数**：`fullTextRecall`

**技术特点**：
- 基于PostgreSQL的全文搜索
- 支持中文分词
- TF-IDF相关性计算

### 3.4 混合检索策略

**核心算法**：RRF (Reciprocal Rank Fusion)

**实现逻辑**：
```typescript
// RRF结果合并 - datasetSearchResultConcat函数
export const datasetSearchResultConcat = (
  arr: { k: number; list: SearchDataResponseItemType[] }[]
): SearchDataResponseItemType[] => {
  const map = new Map<string, SearchDataResponseItemType & { rrfScore: number }>();
  
  // RRF算法实现
  arr.forEach((item) => {
    const k = item.k; // RRF参数k，通常为60
    
    item.list.forEach((data, index) => {
      const rank = index + 1;
      const score = 1 / (k + rank); // RRF公式：1/(k+rank)
      
      const record = map.get(data.id);
      if (record) {
        // 合并已存在的记录
        map.set(data.id, {
          ...record,
          rrfScore: record.rrfScore + score
        });
      } else {
        // 新记录
        map.set(data.id, {
          ...data,
          rrfScore: score
        });
      }
    });
  });
  
  // 按RRF分数排序
  return Array.from(map.values()).sort((a, b) => b.rrfScore - a.rrfScore);
};
```

### 3.5 向量数据库实现

**核心文件**：`packages/service/common/vectorDB/pg/index.ts`

**PgVector实现**：
```typescript
class PgVectorCtrl {
  // 向量检索
  embRecall = async (props: EmbeddingRecallCtrlProps): Promise<EmbeddingRecallResponse> => {
    const { teamId, datasetIds, vector, limit, forbidCollectionIdList, filterCollectionIdList } = props;
    
    // 构建过滤条件
    const forbidCollectionSql = formatForbidCollectionIdList.length > 0
      ? `AND collection_id NOT IN (${formatForbidCollectionIdList.map((id) => `'${id}'`).join(',')})`
      : '';
    
    // 执行向量检索查询
    const results = await PgClient.query(`
      BEGIN;
      SET LOCAL hnsw.ef_search = ${global.systemEnv?.hnswEfSearch || 100};
      SET LOCAL hnsw.max_scan_tuples = ${global.systemEnv?.hnswMaxScanTuples || 100000};
      WITH relaxed_results AS MATERIALIZED (
        select id, collection_id, vector <#> '[${vector}]' AS score
        from ${DatasetVectorTableName}
        where dataset_id IN (${datasetIds.map((id) => `'${String(id)}'`).join(',')})
          ${forbidCollectionSql}
        order by score limit ${limit}
      ) SELECT id, collection_id, score FROM relaxed_results ORDER BY score;
      COMMIT;
    `);
    
    return { results: rows };
  };
}
```

## 4. 生成阶段

### 4.1 工作流引擎

**核心文件**：`packages/service/core/workflow/dispatch/index.ts`

**主要功能**：
- 节点调度和执行
- 数据流转管理
- 错误处理和重试

**关键实现**：
```typescript
export async function dispatchWorkFlow(data: Props): Promise<DispatchFlowResponse> {
  let {
    res,
    runtimeNodes = [],
    runtimeEdges = [],
    histories = [],
    variables = {},
    timezone,
    externalProvider,
    stream = false,
    retainDatasetCite = true,
    version = 'v1',
    responseDetail = true,
    responseAllData = true,
    ...props
  } = data;
  const startTime = Date.now();

  await rewriteRuntimeWorkFlow({ nodes: runtimeNodes, edges: runtimeEdges, lang: data.lang });

  // 初始化深度和自动增加深度，避免无限嵌套
  if (!props.workflowDispatchDeep) {
    props.workflowDispatchDeep = 1;
  } else {
    props.workflowDispatchDeep += 1;
  }
  const isRootRuntime = props.workflowDispatchDeep === 1;

  if (props.workflowDispatchDeep > 20) {
    return {
      flowResponses: [],
      flowUsages: [],
      debugResponse: {
        finishedNodes: [],
        finishedEdges: [],
        nextStepRunNodes: []
      },
      [DispatchNodeResponseKeyEnum.runTimes]: 1,
      [DispatchNodeResponseKeyEnum.assistantResponses]: [],
      [DispatchNodeResponseKeyEnum.toolResponses]: null,
      newVariables: removeSystemVariable(variables, externalProvider.externalWorkflowVariables),
      durationSeconds: 0
    };
  }

  let workflowRunTimes = 0;
  let streamCheckTimer: NodeJS.Timeout | null = null;

  // Init
  if (isRootRuntime) {
    // set sse response headers
    res?.setHeader('Connection', 'keep-alive');
    if (stream && res) {
      res.on('close', () => res.end());
      res.on('error', () => {
        addLog.error('Request error');
        res.end();
      });

      res.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache, no-transform');

      // 10s sends a message to prevent the browser from thinking that the connection is disconnected
      streamCheckTimer = setInterval(() => {
        props?.workflowStreamResponse?({
          event: SseResponseEventEnum.answer,
          data: textAdaptGptResponse({
            text: ''
          })
        });
      }, 10000);
    }

    // Get default variables
    variables = {
      ...externalProvider.externalWorkflowVariables,
      ...getSystemVariables(data)
    };
  }

  let chatResponses: ChatHistoryItemResType[] = [];
  let chatAssistantResponse: AIChatItemValueItemType[] = [];
  let chatNodeUsages: ChatNodeUsageType[] = [];
  let toolRunResponse: ToolRunResponseItemType;
  let debugNextStepRunNodes: RuntimeNodeItemType[] = [];
  let nodeInteractiveResponse: {
    entryNodeIds: string[];
    interactiveResponse: InteractiveNodeResponseType;
  } | undefined;
  let system_memories: Record<string, any> = {};

  // 节点执行逻辑
  const checkNodeCanRun = async (
    node: RuntimeNodeItemType,
    skippedNodeIdList?: Set<string>
  ): Promise<RuntimeNodeItemType[]> => {
    // 检查节点是否可以运行的逻辑
    // ...
  };

  // 执行工作流起始节点
  const startNode = runtimeNodes.find(
    (item) => item.flowNodeType === FlowNodeTypeEnum.workflowStart
  );
  if (startNode) {
    await checkNodeCanRun(startNode);
  }

  const durationSeconds = +((Date.now() - startTime) / 1000).toFixed(2);

  return {
    flowResponses: chatResponses,
    flowUsages: chatNodeUsages,
    debugResponse: {
      finishedNodes: runtimeNodes,
      finishedEdges: runtimeEdges,
      nextStepRunNodes: debugNextStepRunNodes
    },
    [DispatchNodeResponseKeyEnum.runTimes]: workflowRunTimes,
    [DispatchNodeResponseKeyEnum.assistantResponses]: mergeAssistantResponseAnswerText(chatAssistantResponse),
    [DispatchNodeResponseKeyEnum.toolResponses]: toolRunResponse,
    [DispatchNodeResponseKeyEnum.newVariables]: removeSystemVariable(
      variables,
      externalProvider.externalWorkflowVariables
    ),
    [DispatchNodeResponseKeyEnum.memories]: Object.keys(system_memories).length > 0 ? system_memories : undefined,
    durationSeconds
  };
}
```

### 4.2 AI对话节点

**核心文件**：`packages/service/core/workflow/dispatch/ai/chat.ts`

**主要功能**：
- 上下文构建
- LLM调用
- 流式响应处理

**上下文构建逻辑**：
```typescript
const getChatMessages = async ({
  histories,
  systemPrompt,
  userQuery,
  datasetQuoteResults
}: GetChatMessagesProps) => {
  const messages = [];
  
  // 1. 系统提示词
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt
    });
  }
  
  // 2. 历史对话
  messages.push(...histories);
  
  // 3. 检索结果作为上下文
  if (datasetQuoteResults?.length > 0) {
    const contextContent = datasetQuoteResults
      .map(item => item.q)
      .join('\n\n');
    
    messages.push({
      role: 'system',
      content: `参考信息：\n${contextContent}`
    });
  }
  
  // 4. 用户查询
  messages.push({
    role: 'user',
    content: userQuery
  });
  
  return messages;
};
```

### 4.3 LLM调用实现

**关键函数**：`createChatCompletion`

**实现特点**：
- 支持多种LLM提供商
- 流式和非流式响应
- 错误处理和重试机制

## 5. 技术栈总结

### 5.1 数据处理阶段
- **文档解析**：支持多种格式（PDF、Word、TXT等）
- **分块策略**：基于语义的智能分块
- **向量化**：OpenAI Embedding、本地模型
- **存储**：PostgreSQL + PgVector + MongoDB

### 5.2 检索阶段
- **向量检索**：PgVector余弦相似度搜索
- **全文检索**：PostgreSQL全文搜索
- **混合检索**：RRF算法结果合并
- **重排序**：可选的重排序模型

### 5.3 生成阶段
- **工作流引擎**：基于DAG的节点调度
- **上下文管理**：动态上下文构建
- **LLM集成**：支持OpenAI、Claude等多种模型
- **流式响应**：Server-Sent Events实现

## 6. 核心算法详解

### 6.1 RRF (Reciprocal Rank Fusion)

**公式**：`score = 1 / (k + rank)`

**应用场景**：合并向量检索和全文检索结果

**优势**：
- 无需训练参数
- 对不同检索方式的分数分布不敏感
- 计算简单高效

### 6.2 向量相似度计算

**距离度量**：余弦相似度

**公式**：`similarity = 1 - cosine_distance`

**实现**：基于PgVector的`<=>` 操作符

### 6.3 分块策略

**方法**：
- 固定长度分块
- 语义分块
- 重叠分块

**参数**：
- chunk_size: 分块大小
- overlap: 重叠长度
- separator: 分隔符

## 7. 性能优化

### 7.1 检索优化
- **索引优化**：向量索引（HNSW）
- **批量处理**：批量向量化和检索
- **缓存机制**：查询结果缓存

### 7.2 生成优化
- **流式响应**：减少首字延迟
- **并发控制**：限制并发请求数
- **资源管理**：内存和GPU资源管理

## 8. 扩展性设计

### 8.1 模块化架构
- **插件系统**：支持自定义节点
- **工作流模板**：可复用的工作流
- **API接口**：标准化的接口设计

### 8.2 多租户支持
- **数据隔离**：基于teamId的数据隔离
- **资源配额**：用户级别的资源限制
- **权限控制**：细粒度的权限管理

## 9. 总结

FastGPT的RAG实现具有以下特点：

1. **模块化设计**：基于工作流引擎的模块化架构，易于扩展和维护
2. **混合检索**：结合向量检索和全文检索，提高检索准确性
3. **高性能**：基于PgVector的高效向量检索，支持大规模数据
4. **灵活配置**：支持多种模型和参数配置，适应不同场景
5. **生产就绪**：完善的错误处理、监控和扩展性设计

通过深入分析源代码，我们可以看到FastGPT在RAG实现上的技术深度和工程实践，为构建高质量的RAG应用提供了很好的参考。