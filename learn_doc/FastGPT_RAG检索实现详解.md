# FastGPT RAG检索实现详解

## 概述

FastGPT 是一个基于 LLM 大语言模型的知识库问答系统，采用 RAG（Retrieval-Augmented Generation）架构实现智能问答。本文档详细梳理了 FastGPT 中 RAG 的完整实现过程，包括数据处理、检索和生成三个核心阶段。

## RAG 架构概览

FastGPT 的 RAG 实现基于工作流（Workflow）架构，主要包含以下核心组件：

1. **数据处理阶段**：文档导入、分块、向量化
2. **检索阶段**：向量检索、全文检索、结果融合
3. **生成阶段**：上下文构建、LLM 调用、答案生成

## 一、数据处理阶段实现

### 1.1 核心文件

- **主要控制器**：`packages/service/core/dataset/data/controller.ts`
- **数据集管理**：`packages/service/core/dataset/controller.ts`
- **文件处理**：`packages/service/core/dataset/gridfs/controller.ts`

### 1.2 数据处理流程

#### 1.2.1 数据导入

```typescript
// 数据格式化处理
export const formatDatasetDataValue = (data: DatasetDataSchemaType) => {
  // 处理图片描述替换
  // 添加图片URL端点
  // 生成图片预览URL
}
```

#### 1.2.2 文本分块

FastGPT 支持多种分块策略：
- **直接分段**：按段落自然分割
- **LLM 自动处理**：使用 AI 智能分块
- **CSV 导入**：结构化数据处理

#### 1.2.3 向量化处理

数据经过分块后，会通过向量模型进行 embedding 处理，生成高维向量表示，存储在向量数据库中用于后续检索。

### 1.3 数据存储结构

- **MongoDB**：存储原始文档、元数据、分块信息
- **向量数据库**：存储文档向量、支持相似度检索
- **GridFS**：存储大文件（PDF、图片等）

## 二、检索阶段实现

### 2.1 核心文件

- **检索控制器**：`packages/service/core/dataset/search/controller.ts`
- **检索引擎**：实现多种检索策略的融合

### 2.2 检索策略

#### 2.2.1 向量检索（Embedding Recall）

```typescript
// 向量召回函数
const embeddingRecall = async ({
  teamId,
  reRankQuery,
  queries,
  model,
  similarity,
  limit,
  datasetIds,
  searchMode
}) => {
  // 1. 查询向量化
  // 2. 向量相似度计算
  // 3. 结果排序和过滤
  // 4. 数据格式化
}
```

**实现特点**：
- 支持多查询向量检索
- 相似度阈值过滤
- 结果去重和排序

#### 2.2.2 全文检索（Full Text Recall）

```typescript
// 全文召回函数
const fullTextRecall = async ({
  teamId,
  reRankQuery,
  queries,
  limit,
  datasetIds,
  searchMode
}) => {
  // 1. MongoDB 文本搜索
  // 2. 结果聚合
  // 3. 分数计算
  // 4. 格式化输出
}
```

**实现特点**：
- 基于 MongoDB 全文索引
- 支持中文分词
- TF-IDF 相关性评分

#### 2.2.3 混合检索（Multi Query Recall）

```typescript
// 多查询召回 - RRF 融合
const multiQueryRecall = async (params) => {
  // 1. 并行执行向量检索和全文检索
  const [embeddingResults, fullTextResults] = await Promise.all([
    embeddingRecall(params),
    fullTextRecall(params)
  ]);
  
  // 2. RRF (Reciprocal Rank Fusion) 结果融合
  const rrfResults = rrfConcatResults([
    embeddingResults,
    fullTextResults
  ]);
  
  return rrfResults;
}
```

### 2.3 检索优化

#### 2.3.1 重排序（ReRank）

```typescript
// 数据集数据重排序
export const datasetDataReRank = async ({
  query,
  data,
  model
}) => {
  // 1. 使用专门的重排序模型
  // 2. 计算查询与文档的相关性得分
  // 3. 重新排序结果
  // 4. 合并原始分数
}
```

#### 2.3.2 结果过滤

```typescript
// 按最大令牌数过滤
export const filterDatasetDataByMaxTokens = ({
  data,
  maxTokens
}) => {
  // 1. 计算每个文档的 token 数
  // 2. 累计计算，确保不超过限制
  // 3. 返回过滤后的结果
}
```

### 2.4 检索主流程

```typescript
// 主检索函数
export const searchDatasetData = async (props: SearchDatasetDataProps) => {
  // 1. 参数解析和验证
  const { teamId, reRankQuery, queries, model, similarity, limit } = props;
  
  // 2. 执行检索
  const { results } = await multiQueryRecall({
    teamId,
    reRankQuery,
    queries,
    model,
    similarity,
    limit,
    datasetIds,
    searchMode
  });
  
  // 3. 重排序（可选）
  const reRankResults = reRankQuery 
    ? await datasetDataReRank({ query: reRankQuery, data: results, model })
    : results;
  
  // 4. 结果过滤
  const filteredResults = filterDatasetDataByMaxTokens({
    data: reRankResults,
    maxTokens
  });
  
  return filteredResults;
}
```

## 三、生成阶段实现

### 3.1 核心文件

- **AI对话节点**：`packages/service/core/workflow/dispatch/ai/chat.ts`
- **工作流引擎**：负责节点间的数据传递和执行调度

### 3.2 生成流程

#### 3.2.1 上下文构建

```typescript
// 获取聊天消息
async function getChatMessages({
  model,
  maxTokens,
  aiChatQuoteRole,
  datasetQuotePrompt,
  datasetQuoteText,
  useDatasetQuote,
  histories,
  systemPrompt,
  userChatInput,
  userFiles,
  documentQuoteText
}) {
  // 1. 构建数据集引用提示词
  const quoteRole = aiChatQuoteRole === 'user' || 
    datasetQuotePrompt.includes('{{question}}') ? 'user' : 'system';
  
  // 2. 替换用户输入（如果引用角色是user）
  const replaceInputValue = useDatasetQuote && quoteRole === 'user'
    ? replaceVariable(datasetQuotePromptTemplate, {
        quote: datasetQuoteText,
        question: userChatInput
      })
    : userChatInput;
  
  // 3. 拼接系统提示词
  const concatenateSystemPrompt = [
    model.defaultSystemChatPrompt,
    systemPrompt,
    useDatasetQuote && quoteRole === 'system'
      ? replaceVariable(datasetQuotePromptTemplate, {
          quote: datasetQuoteText
        })
      : '',
    documentQuoteText
      ? replaceVariable(getDocumentQuotePrompt(version), {
          quote: documentQuoteText
        })
      : ''
  ].filter(Boolean).join('\n\n===---===---===\n\n');
  
  // 4. 构建完整消息列表
  const messages = [
    ...getSystemPrompt_ChatItemType(concatenateSystemPrompt),
    ...histories,
    {
      obj: ChatRoleEnum.Human,
      value: runtimePrompt2ChatsValue({
        files: userFiles,
        text: replaceInputValue
      })
    }
  ];
  
  return { filterMessages };
}
```

#### 3.2.2 LLM 调用

```typescript
// AI对话主函数
export const dispatchChatCompletion = async (props: ChatProps) => {
  // 1. 参数解析
  const { model, temperature, maxToken, quoteQA, userChatInput } = props.params;
  
  // 2. 模型验证
  const modelConstantsData = getLLMModel(model);
  if (!modelConstantsData) {
    return getNodeErrResponse({ error: `Model ${model} is undefined` });
  }
  
  // 3. 处理检索结果和文档引用
  const [{ datasetQuoteText }, { documentQuoteText, userFiles }] = await Promise.all([
    filterDatasetQuote({ quoteQA, model: modelConstantsData }),
    getMultiInput({ histories, inputFiles, fileLinks })
  ]);
  
  // 4. 构建请求消息
  const { filterMessages } = await getChatMessages({
    model: modelConstantsData,
    maxTokens: max_tokens,
    histories: chatHistories,
    useDatasetQuote: quoteQA !== undefined,
    datasetQuoteText,
    aiChatQuoteRole,
    userChatInput,
    systemPrompt,
    userFiles,
    documentQuoteText
  });
  
  // 5. 调用LLM
  const requestBody = llmCompletionsBodyFormat({
    model: modelConstantsData.model,
    stream,
    messages: requestMessages,
    temperature,
    max_tokens
  }, modelConstantsData);
  
  const { response, isStreamResponse } = await createChatCompletion({
    body: requestBody,
    userKey: externalProvider.openaiAccount
  });
  
  // 6. 处理响应
  const { answerText, reasoningText } = await processResponse(response);
  
  return {
    data: {
      answerText: answerText.trim(),
      reasoningText,
      history: chatCompleteMessages
    }
  };
}
```

#### 3.2.3 流式响应处理

```typescript
// 流式响应处理
async function streamResponse({
  res,
  stream,
  workflowStreamResponse,
  aiChatReasoning,
  isResponseAnswerText,
  retainDatasetCite
}) {
  const { parsePart, getResponseData } = parseLLMStreamResponse();
  
  for await (const part of stream) {
    const { reasoningContent, responseContent } = parsePart({
      part,
      parseThinkTag,
      retainDatasetCite
    });
    
    // 推理内容流式输出
    if (aiChatReasoning && reasoningContent) {
      workflowStreamResponse?.({
        event: SseResponseEventEnum.answer,
        data: textAdaptGptResponse({ reasoning_content: reasoningContent })
      });
    }
    
    // 答案内容流式输出
    if (isResponseAnswerText && responseContent) {
      workflowStreamResponse?.({
        event: SseResponseEventEnum.answer,
        data: textAdaptGptResponse({ text: responseContent })
      });
    }
  }
  
  return getResponseData();
}
```

## 四、工作流协调机制

### 4.1 节点执行流程

FastGPT 采用基于 Flow 的工作流编排：

1. **流程开始节点**：接收用户输入
2. **知识库搜索节点**：执行检索逻辑
3. **AI对话节点**：整合检索结果生成答案
4. **输出节点**：返回最终结果

### 4.2 数据传递机制

- **输入参数**：每个节点定义输入参数类型
- **输出结果**：节点执行后产生输出数据
- **变量引用**：后续节点可引用前置节点的输出
- **上下文管理**：维护整个对话的历史记录

## 五、关键技术特性

### 5.1 多模态支持

- **文本处理**：支持多种文档格式（PDF、Word、Markdown）
- **图片识别**：集成视觉模型处理图片内容
- **文件引用**：支持文件链接和内容提取

### 5.2 检索优化

- **混合检索**：向量检索 + 全文检索
- **RRF融合**：Reciprocal Rank Fusion 结果融合
- **重排序**：使用专门模型提升相关性
- **动态过滤**：基于token限制和相似度阈值

### 5.3 生成优化

- **上下文管理**：智能截断和优化
- **引用模板**：灵活的引用格式配置
- **流式输出**：实时响应用户
- **推理过程**：支持思维链展示

## 六、核心文件总结

### 6.1 数据处理相关

| 文件路径 | 功能描述 |
|---------|----------|
| `packages/service/core/dataset/data/controller.ts` | 数据集数据处理控制器 |
| `packages/service/core/dataset/controller.ts` | 数据集管理控制器 |
| `packages/service/core/dataset/gridfs/controller.ts` | 文件存储处理 |

### 6.2 检索相关

| 文件路径 | 功能描述 |
|---------|----------|
| `packages/service/core/dataset/search/controller.ts` | 检索引擎核心实现 |
| `packages/service/core/workflow/dispatch/dataset/searchDataset.ts` | 数据集搜索节点 |

### 6.3 生成相关

| 文件路径 | 功能描述 |
|---------|----------|
| `packages/service/core/workflow/dispatch/ai/chat.ts` | AI对话节点核心实现 |
| `packages/service/core/ai/config.ts` | AI模型配置和调用 |
| `packages/service/core/chat/utils.ts` | 聊天工具函数 |

### 6.4 工作流相关

| 文件路径 | 功能描述 |
|---------|----------|
| `packages/service/core/workflow/dispatch/` | 工作流节点调度器 |
| `packages/global/core/workflow/` | 工作流类型定义和工具 |

## 七、总结

FastGPT 的 RAG 实现具有以下特点：

1. **模块化设计**：清晰的分层架构，便于维护和扩展
2. **多策略检索**：结合向量检索和全文检索，提升召回率
3. **智能融合**：RRF算法优化检索结果排序
4. **灵活配置**：支持多种模型和参数配置
5. **工作流编排**：可视化的流程设计，易于定制
6. **实时响应**：流式输出提升用户体验

这种设计使得 FastGPT 能够在保证检索准确性的同时，提供灵活的定制能力和良好的用户体验。