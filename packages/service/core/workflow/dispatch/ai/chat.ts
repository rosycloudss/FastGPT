/**
 * AI对话节点调度器
 * 
 * 这是FastGPT工作流中最核心的节点之一，负责处理AI对话的完整流程。
 * 主要功能包括：
 * 1. 消息上下文构建和管理
 * 2. 数据集引用和文档引用处理
 * 3. 多模态输入支持（文本、图片、文件）
 * 4. 流式响应和实时输出
 * 5. 推理过程展示
 * 6. Token使用统计和计费
 * 7. 内容审核和安全检查
 * 8. 历史对话管理
 * 
 * 核心特性：
 * - 支持多种LLM模型（OpenAI、Claude、本地模型等）
 * - 智能上下文管理，自动截断超长对话
 * - 数据集检索结果的智能引用
 * - 文档内容的自动解析和引用
 * - 推理过程的实时展示
 * - 流式响应优化用户体验
 * - 完整的错误处理和异常恢复
 * 
 * 处理流程：
 * 1. 参数验证和模型配置
 * 2. 构建对话上下文（系统提示词、历史对话、用户输入）
 * 3. 处理数据集引用和文档引用
 * 4. 调用LLM API进行对话
 * 5. 解析响应并进行流式输出
 * 6. 统计使用量并返回结果
 */

import type { NextApiResponse } from 'next';
import { filterGPTMessageByMaxContext, loadRequestMessages } from '../../../chat/utils';
import type { ChatItemType, UserChatItemValueItemType } from '@fastgpt/global/core/chat/type.d';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import { SseResponseEventEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { textAdaptGptResponse } from '@fastgpt/global/core/workflow/runtime/utils';
import {
  removeDatasetCiteText,
  parseReasoningContent,
  parseLLMStreamResponse
} from '../../../ai/utils';
import { createChatCompletion } from '../../../ai/config';
import type {
  ChatCompletionMessageParam,
  CompletionFinishReason,
  StreamChatType
} from '@fastgpt/global/core/ai/type.d';
import { formatModelChars2Points } from '../../../../support/wallet/usage/utils';
import type { LLMModelItemType } from '@fastgpt/global/core/ai/model.d';
import { ChatCompletionRequestMessageRoleEnum } from '@fastgpt/global/core/ai/constants';
import type {
  ChatDispatchProps,
  DispatchNodeResultType
} from '@fastgpt/global/core/workflow/runtime/type';
import { countGptMessagesTokens } from '../../../../common/string/tiktoken/index';
import {
  chats2GPTMessages,
  chatValue2RuntimePrompt,
  getSystemPrompt_ChatItemType,
  GPTMessages2Chats,
  runtimePrompt2ChatsValue
} from '@fastgpt/global/core/chat/adapt';
import {
  getQuoteTemplate,
  getQuotePrompt,
  getDocumentQuotePrompt
} from '@fastgpt/global/core/ai/prompt/AIChat';
import type { AIChatNodeProps } from '@fastgpt/global/core/workflow/runtime/type.d';
import { replaceVariable } from '@fastgpt/global/common/string/tools';
import type { ModuleDispatchProps } from '@fastgpt/global/core/workflow/runtime/type';
import { responseWriteController } from '../../../../common/response';
import { getLLMModel } from '../../../ai/model';
import type { SearchDataResponseItemType } from '@fastgpt/global/core/dataset/type';
import type { NodeOutputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import { NodeInputKeyEnum } from '@fastgpt/global/core/workflow/constants';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { checkQuoteQAValue, getNodeErrResponse, getHistories } from '../utils';
import { filterSearchResultsByMaxChars } from '../../utils';
import { getHistoryPreview } from '@fastgpt/global/core/chat/utils';
import { computedMaxToken, llmCompletionsBodyFormat } from '../../../ai/utils';
import { type WorkflowResponseType } from '../type';
import { formatTime2YMDHM } from '@fastgpt/global/common/string/time';
import { type AiChatQuoteRoleType } from '@fastgpt/global/core/workflow/template/system/aiChat/type';
import { getFileContentFromLinks, getHistoryFileLinks } from '../tools/readFiles';
import { parseUrlToFileType } from '@fastgpt/global/common/file/tools';
import { i18nT } from '../../../../../web/i18n/utils';
import { ModelTypeEnum } from '@fastgpt/global/core/ai/model';
import { postTextCensor } from '../../../chat/postTextCensor';
import { getErrText } from '@fastgpt/global/common/error/utils';

/**
 * AI对话节点输入参数类型
 * 
 * 定义了AI对话节点的所有输入参数，包括基础配置和动态输入。
 */
export type ChatProps = ModuleDispatchProps<
  AIChatNodeProps & {
    /** 用户聊天输入内容 */
    [NodeInputKeyEnum.userChatInput]?: string;
    /** 对话历史，可以是历史记录数组或历史记录数量 */
    [NodeInputKeyEnum.history]?: ChatItemType[] | number;
    /** 数据集检索引用结果 */
    [NodeInputKeyEnum.aiChatDatasetQuote]?: SearchDataResponseItemType[];
  }
>;

/**
 * AI对话节点输出结果类型
 * 
 * 定义了AI对话节点的输出结果结构，包括成功和错误情况。
 */
export type ChatResponse = DispatchNodeResultType<
  {
    /** AI回答文本 */
    [NodeOutputKeyEnum.answerText]: string;
    /** 推理过程文本（可选） */
    [NodeOutputKeyEnum.reasoningText]?: string;
    /** 更新后的对话历史 */
    [NodeOutputKeyEnum.history]: ChatItemType[];
  },
  {
    /** 错误信息文本 */
    [NodeOutputKeyEnum.errorText]: string;
  }
>;

/**
 * AI对话节点调度函数
 * 
 * 这是AI对话节点的主要执行函数，负责处理完整的AI对话流程。
 * 从用户输入到AI响应的全过程管理。
 * 
 * 主要处理步骤：
 * 1. 参数验证和模型配置检查
 * 2. 构建对话上下文（历史对话、系统提示词、用户输入）
 * 3. 处理数据集引用和文档引用
 * 4. 内容审核（如果启用）
 * 5. 调用LLM API进行对话生成
 * 6. 处理流式响应或一次性响应
 * 7. 解析推理过程和回答内容
 * 8. 统计Token使用量和计费
 * 9. 返回格式化的结果
 * 
 * 支持的功能：
 * - 多模态输入（文本、图片、文件）
 * - 数据集检索结果引用
 * - 文档内容引用
 * - 推理过程展示
 * - 流式响应
 * - 历史对话管理
 * - 内容安全检查
 * 
 * @param props - AI对话节点的输入参数
 * @returns Promise<ChatResponse> - AI对话的执行结果
 * 
 * @example
 * ```typescript
 * const result = await dispatchChatCompletion({
 *   params: {
 *     model: 'gpt-3.5-turbo',
 *     userChatInput: '你好，请介绍一下FastGPT',
 *     systemPrompt: '你是一个AI助手',
 *     temperature: 0.7,
 *     maxToken: 2000
 *   },
 *   // ... 其他参数
 * });
 * 
 * console.log('AI回答:', result.data.answerText);
 * ```
 */
export const dispatchChatCompletion = async (props: ChatProps): Promise<ChatResponse> => {
  let {
    res,                          // HTTP响应对象，用于流式输出
    requestOrigin,                // 请求来源
    stream = false,               // 是否启用流式响应
    retainDatasetCite = true,     // 是否保留数据集引用
    externalProvider,             // 外部提供者配置
    histories,                    // 对话历史
    node: { name, version, inputs }, // 节点信息
    query,                        // 用户查询
    runningUserInfo,              // 运行用户信息
    workflowStreamResponse,       // 工作流流式响应函数
    chatConfig,                   // 聊天配置
    params: {
      model,                      // 使用的LLM模型
      temperature,                // 温度参数，控制回答的随机性
      maxToken,                   // 最大Token数量
      history = 6,                // 历史对话轮数
      quoteQA,                    // 数据集检索引用
      userChatInput = '',         // 用户输入文本
      isResponseAnswerText = true, // 是否响应回答文本
      systemPrompt = '',          // 系统提示词
      aiChatQuoteRole = 'system', // 引用角色（system/user）
      quoteTemplate,              // 引用模板
      quotePrompt,                // 引用提示词
      aiChatVision,               // 是否启用视觉功能
      aiChatReasoning = true,     // 是否启用推理功能
      aiChatTopP,                 // Top-P参数
      aiChatStopSign,             // 停止标志
      aiChatResponseFormat,       // 响应格式
      aiChatJsonSchema,           // JSON Schema

      fileUrlList: fileLinks,     // 节点引用的文件链接
      stringQuoteText             // 字符串引用文本（已废弃）
    }
  } = props;
  const { files: inputFiles } = chatValue2RuntimePrompt(query); // 从聊天框输入中提取文件

  // 1. 模型配置验证
  const modelConstantsData = getLLMModel(model);
  if (!modelConstantsData) {
    return getNodeErrResponse({
      error: `Model ${model} is undefined, you need to select a chat model.`
    });
  }

  try {
    aiChatVision = modelConstantsData.vision && aiChatVision;
    aiChatReasoning = !!aiChatReasoning && !!modelConstantsData.reasoning;
    // Check fileLinks is reference variable
    const fileUrlInput = inputs.find((item) => item.key === NodeInputKeyEnum.fileUrlList);
    if (!fileUrlInput || !fileUrlInput.value || fileUrlInput.value.length === 0) {
      fileLinks = undefined;
    }

    const chatHistories = getHistories(history, histories);
    quoteQA = checkQuoteQAValue(quoteQA);

    const [{ datasetQuoteText }, { documentQuoteText, userFiles }] = await Promise.all([
      filterDatasetQuote({
        quoteQA,
        model: modelConstantsData,
        quoteTemplate: quoteTemplate || getQuoteTemplate(version)
      }),
      getMultiInput({
        histories: chatHistories,
        inputFiles,
        fileLinks,
        stringQuoteText,
        requestOrigin,
        maxFiles: chatConfig?.fileSelectConfig?.maxFiles || 20,
        customPdfParse: chatConfig?.fileSelectConfig?.customPdfParse,
        runningUserInfo
      })
    ]);

    if (!userChatInput && !documentQuoteText && userFiles.length === 0) {
      return getNodeErrResponse({ error: i18nT('chat:AI_input_is_empty') });
    }

    const max_tokens = computedMaxToken({
      model: modelConstantsData,
      maxToken
    });

    const [{ filterMessages }] = await Promise.all([
      getChatMessages({
        model: modelConstantsData,
        maxTokens: max_tokens,
        histories: chatHistories,
        useDatasetQuote: quoteQA !== undefined,
        datasetQuoteText,
        aiChatQuoteRole,
        datasetQuotePrompt: quotePrompt,
        version,
        userChatInput,
        systemPrompt,
        userFiles,
        documentQuoteText
      }),
      // Censor = true and system key, will check content
      (() => {
        if (modelConstantsData.censor && !externalProvider.openaiAccount?.key) {
          return postTextCensor({
            text: `${systemPrompt}
            ${userChatInput}
          `
          });
        }
      })()
    ]);

    const requestMessages = await loadRequestMessages({
      messages: filterMessages,
      useVision: aiChatVision,
      origin: requestOrigin
    });

    const requestBody = llmCompletionsBodyFormat(
      {
        model: modelConstantsData.model,
        stream,
        messages: requestMessages,
        temperature,
        max_tokens,
        top_p: aiChatTopP,
        stop: aiChatStopSign,
        response_format: {
          type: aiChatResponseFormat as any,
          json_schema: aiChatJsonSchema
        }
      },
      modelConstantsData
    );
    // console.log(JSON.stringify(requestBody, null, 2), '===');
    const { response, isStreamResponse, getEmptyResponseTip } = await createChatCompletion({
      body: requestBody,
      userKey: externalProvider.openaiAccount,
      options: {
        headers: {
          Accept: 'application/json, text/plain, */*'
        }
      }
    });

    let { answerText, reasoningText, finish_reason, inputTokens, outputTokens } =
      await (async () => {
        if (isStreamResponse) {
          if (!res || res.closed) {
            return {
              answerText: '',
              reasoningText: '',
              finish_reason: 'close' as const,
              inputTokens: 0,
              outputTokens: 0
            };
          }
          // sse response
          const { answer, reasoning, finish_reason, usage } = await streamResponse({
            res,
            stream: response,
            aiChatReasoning,
            parseThinkTag: modelConstantsData.reasoning,
            isResponseAnswerText,
            workflowStreamResponse,
            retainDatasetCite
          });

          return {
            answerText: answer,
            reasoningText: reasoning,
            finish_reason,
            inputTokens: usage?.prompt_tokens,
            outputTokens: usage?.completion_tokens
          };
        } else {
          const finish_reason = response.choices?.[0]?.finish_reason as CompletionFinishReason;
          const usage = response.usage;

          const { content, reasoningContent } = (() => {
            const content = response.choices?.[0]?.message?.content || '';
            const reasoningContent: string =
              // @ts-ignore
              response.choices?.[0]?.message?.reasoning_content || '';

            // API already parse reasoning content
            if (reasoningContent || !aiChatReasoning) {
              return {
                content,
                reasoningContent
              };
            }

            const [think, answer] = parseReasoningContent(content);
            return {
              content: answer,
              reasoningContent: think
            };
          })();

          const formatReasonContent = removeDatasetCiteText(reasoningContent, retainDatasetCite);
          const formatContent = removeDatasetCiteText(content, retainDatasetCite);

          // Some models do not support streaming
          if (aiChatReasoning && reasoningContent) {
            workflowStreamResponse?.({
              event: SseResponseEventEnum.fastAnswer,
              data: textAdaptGptResponse({
                reasoning_content: formatReasonContent
              })
            });
          }
          if (isResponseAnswerText && content) {
            workflowStreamResponse?.({
              event: SseResponseEventEnum.fastAnswer,
              data: textAdaptGptResponse({
                text: formatContent
              })
            });
          }

          return {
            reasoningText: formatReasonContent,
            answerText: formatContent,
            finish_reason,
            inputTokens: usage?.prompt_tokens,
            outputTokens: usage?.completion_tokens
          };
        }
      })();

    if (!answerText && !reasoningText) {
      return getNodeErrResponse({ error: getEmptyResponseTip() });
    }

    const AIMessages: ChatCompletionMessageParam[] = [
      {
        role: ChatCompletionRequestMessageRoleEnum.Assistant,
        content: answerText,
        reasoning_text: reasoningText // reasoning_text is only recorded for response, but not for request
      }
    ];

    const completeMessages = [...requestMessages, ...AIMessages];
    const chatCompleteMessages = GPTMessages2Chats(completeMessages);

    inputTokens = inputTokens || (await countGptMessagesTokens(requestMessages));
    outputTokens = outputTokens || (await countGptMessagesTokens(AIMessages));

    const { totalPoints, modelName } = formatModelChars2Points({
      model,
      inputTokens,
      outputTokens,
      modelType: ModelTypeEnum.llm
    });

    const trimAnswer = answerText.trim();
    return {
      data: {
        answerText: trimAnswer,
        reasoningText,
        history: chatCompleteMessages
      },
      [DispatchNodeResponseKeyEnum.answerText]: isResponseAnswerText ? trimAnswer : undefined,
      [DispatchNodeResponseKeyEnum.reasoningText]: aiChatReasoning ? reasoningText : undefined,

      [DispatchNodeResponseKeyEnum.nodeResponse]: {
        totalPoints: externalProvider.openaiAccount?.key ? 0 : totalPoints,
        model: modelName,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        query: `${userChatInput}`,
        maxToken: max_tokens,
        reasoningText,
        historyPreview: getHistoryPreview(chatCompleteMessages, 10000, aiChatVision),
        contextTotalLen: completeMessages.length,
        finishReason: finish_reason
      },
      [DispatchNodeResponseKeyEnum.nodeDispatchUsages]: [
        {
          moduleName: name,
          totalPoints: externalProvider.openaiAccount?.key ? 0 : totalPoints,
          model: modelName,
          inputTokens: inputTokens,
          outputTokens: outputTokens
        }
      ],
      [DispatchNodeResponseKeyEnum.toolResponses]: answerText
    };
  } catch (error) {
    return getNodeErrResponse({ error });
  }
};

async function filterDatasetQuote({
  quoteQA = [],
  model,
  quoteTemplate
}: {
  quoteQA: ChatProps['params']['quoteQA'];
  model: LLMModelItemType;
  quoteTemplate: string;
}) {
  function getValue({ item, index }: { item: SearchDataResponseItemType; index: number }) {
    return replaceVariable(quoteTemplate, {
      id: item.id,
      q: item.q,
      a: item.a || '',
      updateTime: formatTime2YMDHM(item.updateTime),
      source: item.sourceName,
      sourceId: String(item.sourceId || ''),
      index: index + 1
    });
  }

  // slice filterSearch
  const filterQuoteQA = await filterSearchResultsByMaxChars(quoteQA, model.quoteMaxToken);

  const datasetQuoteText =
    filterQuoteQA.length > 0
      ? `${filterQuoteQA.map((item, index) => getValue({ item, index }).trim()).join('\n------\n')}`
      : '';

  return {
    datasetQuoteText
  };
}

async function getMultiInput({
  histories,
  inputFiles,
  fileLinks,
  stringQuoteText,
  requestOrigin,
  maxFiles,
  customPdfParse,
  runningUserInfo
}: {
  histories: ChatItemType[];
  inputFiles: UserChatItemValueItemType['file'][];
  fileLinks?: string[];
  stringQuoteText?: string; // file quote
  requestOrigin?: string;
  maxFiles: number;
  customPdfParse?: boolean;
  runningUserInfo: ChatDispatchProps['runningUserInfo'];
}) {
  // 旧版本适配====>
  if (stringQuoteText) {
    return {
      documentQuoteText: stringQuoteText,
      userFiles: inputFiles
    };
  }

  // 没有引用文件参考，但是可能用了图片识别
  if (!fileLinks) {
    return {
      documentQuoteText: '',
      userFiles: inputFiles
    };
  }
  // 旧版本适配<====

  // If fileLinks params is not empty, it means it is a new version, not get the global file.

  // Get files from histories
  const filesFromHistories = getHistoryFileLinks(histories);
  const urls = [...fileLinks, ...filesFromHistories];

  if (urls.length === 0) {
    return {
      documentQuoteText: '',
      userFiles: []
    };
  }

  const { text } = await getFileContentFromLinks({
    // Concat fileUrlList and filesFromHistories; remove not supported files
    urls,
    requestOrigin,
    maxFiles,
    customPdfParse,
    teamId: runningUserInfo.teamId,
    tmbId: runningUserInfo.tmbId
  });

  return {
    documentQuoteText: text,
    userFiles: fileLinks.map((url) => parseUrlToFileType(url)).filter(Boolean)
  };
}

async function getChatMessages({
  model,
  maxTokens = 0,
  aiChatQuoteRole,
  datasetQuotePrompt = '',
  datasetQuoteText,
  useDatasetQuote,
  version,
  histories = [],
  systemPrompt,
  userChatInput,
  userFiles,
  documentQuoteText
}: {
  model: LLMModelItemType;
  maxTokens?: number;
  // dataset quote
  aiChatQuoteRole: AiChatQuoteRoleType; // user: replace user prompt; system: replace system prompt
  datasetQuotePrompt?: string;
  datasetQuoteText: string;
  version?: string;

  useDatasetQuote: boolean;
  histories: ChatItemType[];
  systemPrompt: string;
  userChatInput: string;

  userFiles: UserChatItemValueItemType['file'][];
  documentQuoteText?: string; // document quote
}) {
  // Dataset prompt ====>
  // User role or prompt include question
  const quoteRole =
    aiChatQuoteRole === 'user' || datasetQuotePrompt.includes('{{question}}') ? 'user' : 'system';

  const defaultQuotePrompt = getQuotePrompt(version, quoteRole);

  const datasetQuotePromptTemplate = datasetQuotePrompt || defaultQuotePrompt;

  // Reset user input, add dataset quote to user input
  const replaceInputValue =
    useDatasetQuote && quoteRole === 'user'
      ? replaceVariable(datasetQuotePromptTemplate, {
          quote: datasetQuoteText,
          question: userChatInput
        })
      : userChatInput;
  // Dataset prompt <====

  // Concat system prompt
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
  ]
    .filter(Boolean)
    .join('\n\n===---===---===\n\n');

  const messages: ChatItemType[] = [
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

  const adaptMessages = chats2GPTMessages({ messages, reserveId: false });

  const filterMessages = await filterGPTMessageByMaxContext({
    messages: adaptMessages,
    maxContext: model.maxContext - maxTokens // filter token. not response maxToken
  });

  return {
    filterMessages
  };
}

async function streamResponse({
  res,
  stream,
  workflowStreamResponse,
  aiChatReasoning,
  parseThinkTag,
  isResponseAnswerText,
  retainDatasetCite = true
}: {
  res: NextApiResponse;
  stream: StreamChatType;
  workflowStreamResponse?: WorkflowResponseType;
  aiChatReasoning?: boolean;
  parseThinkTag?: boolean;
  isResponseAnswerText?: boolean;
  retainDatasetCite: boolean;
}) {
  const write = responseWriteController({
    res,
    readStream: stream
  });

  const { parsePart, getResponseData, updateFinishReason } = parseLLMStreamResponse();

  for await (const part of stream) {
    if (res.closed) {
      stream.controller?.abort();
      updateFinishReason('close');
      break;
    }

    const { reasoningContent, responseContent } = parsePart({
      part,
      parseThinkTag,
      retainDatasetCite
    });

    if (aiChatReasoning && reasoningContent) {
      workflowStreamResponse?.({
        write,
        event: SseResponseEventEnum.answer,
        data: textAdaptGptResponse({
          reasoning_content: reasoningContent
        })
      });
    }

    if (isResponseAnswerText && responseContent) {
      workflowStreamResponse?.({
        write,
        event: SseResponseEventEnum.answer,
        data: textAdaptGptResponse({
          text: responseContent
        })
      });
    }
  }

  const { reasoningContent: reasoning, content: answer, finish_reason, usage } = getResponseData();

  return { answer, reasoning, finish_reason, usage };
}
