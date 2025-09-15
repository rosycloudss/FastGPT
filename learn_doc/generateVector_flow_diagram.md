# FastGPT 训练数据生成向量完整流程图

## 概述

本文档详细描述了以 `generateVector` 为入口的训练数据生成向量的完整流程，包括数据处理、向量生成、数据库操作等各个环节。

## 主流程图

```mermaid
flowchart TD
    A["🚀 generateVector 队列启动"] --> B{"📊 检查队列长度"}
    B -->|"队列未满"| C["🔍 查询待处理训练数据"]
    B -->|"队列已满"| Z1["⏸️ 延迟等待"]
    Z1 --> A
    
    C --> D{"📝 是否找到训练数据"}
    D -->|"无数据"| Z2["⏸️ 延迟等待"]
    Z2 --> A
    D -->|"找到数据"| E["🔒 锁定训练数据"]
    
    E --> F["📋 关联查询数据集信息"]
    F --> G{"💰 检查团队AI积分"}
    G -->|"积分不足"| H["❌ 记录错误并退出"]
    G -->|"积分充足"| I{"🔄 判断处理模式"}
    
    I -->|"dataId存在"| J["🔄 rebuildData 重建数据"]
    I -->|"dataId不存在"| K["➕ insertData 插入新数据"]
    
    %% 重建数据流程
    J --> J1["🔍 查找现有数据"]
    J1 --> J2{"📊 数据是否存在"}
    J2 -->|"不存在"| J3["🗑️ 删除训练任务"]
    J2 -->|"存在"| J4["📝 提取旧向量ID列表"]
    J4 --> J5["🔍 查找下一个重建数据"]
    J5 --> J6{"🔄 是否有下一个数据"}
    J6 -->|"有"| J7["➕ 创建下一个训练任务"]
    J6 -->|"无"| J8["🎯 生成新向量"]
    J7 --> J8
    J8 --> J9["💾 更新数据索引"]
    J9 --> J10["🗑️ 删除训练任务"]
    J10 --> J11["🗑️ 删除旧向量"]
    J11 --> L["📊 记录使用量"]
    
    %% 插入新数据流程
    K --> K1["📝 调用insertData2Dataset"]
    K1 --> K2["🎯 生成向量"]
    K2 --> K3["💾 插入MongoDB数据"]
    K3 --> K4["💾 插入向量数据库"]
    K4 --> K5["🗑️ 删除训练任务"]
    K5 --> L
    
    L --> M["✅ 任务完成"]
    M --> A
    
    %% 错误处理
    H --> N["📝 更新错误信息"]
    N --> O["🔄 重试计数处理"]
    O --> A
    
    %% 样式定义
    classDef startEnd fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef process fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef database fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class A,M startEnd
    class C,E,F,J,K,J1,J4,J5,J7,J8,J9,J10,J11,K1,K2,K3,K4,K5,L process
    class B,D,G,I,J2,J6 decision
    class N,O error
```

## 详细子流程图

### 1. insertData2Dataset 数据插入流程

```mermaid
flowchart TD
    A1["📝 insertData2Dataset 开始"] --> B1["🆔 生成数据ID"]
    B1 --> C1["🎯 调用getVectorsByText"]
    C1 --> D1["💾 插入向量到数据库"]
    D1 --> E1["📋 构建索引数据"]
    E1 --> F1["💾 插入MongoDB数据"]
    F1 --> G1["✅ 返回token统计"]
    
    classDef process fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    class A1,B1,C1,D1,E1,F1,G1 process
```

### 2. getVectorsByText 向量生成流程

```mermaid
flowchart TD
    A2["🎯 getVectorsByText 开始"] --> B2["📝 输入验证"]
    B2 --> C2["📊 格式化输入数据"]
    C2 --> D2["🔄 批量处理(每批20个)"]
    D2 --> E2["🤖 调用AI API"]
    E2 --> F2["📏 向量维度统一"]
    F2 --> G2["📊 向量标准化"]
    G2 --> H2["🔢 计算token数量"]
    H2 --> I2["✅ 返回向量和token"]
    
    classDef process fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    class A2,B2,C2,D2,E2,F2,G2,H2,I2 process
```

### 3. 向量数据库操作流程

```mermaid
flowchart TD
    A3["💾 向量数据库操作"] --> B3{"🔍 选择数据库类型"}
    B3 -->|"PostgreSQL"| C3["🐘 PgVectorCtrl"]
    B3 -->|"OceanBase"| D3["🌊 ObVectorCtrl"]
    B3 -->|"Milvus"| E3["🔍 MilvusCtrl"]
    
    C3 --> F3["📋 构建SQL语句"]
    D3 --> F3
    E3 --> G3["📋 构建查询参数"]
    
    F3 --> H3["💾 执行插入操作"]
    G3 --> H3
    H3 --> I3["🆔 返回插入ID列表"]
    
    classDef process fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef database fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    
    class A3,F3,G3,H3,I3 process
    class B3 decision
    class C3,D3,E3 database
```

### 4. 数据库事务处理流程

```mermaid
flowchart TD
    A4["🔄 mongoSessionRun 开始"] --> B4["🚀 启动MongoDB事务"]
    B4 --> C4["💾 执行数据库操作"]
    C4 --> D4{"🔍 操作是否成功"}
    D4 -->|"成功"| E4["✅ 提交事务"]
    D4 -->|"失败"| F4["❌ 回滚事务"]
    E4 --> G4["✅ 返回结果"]
    F4 --> H4["❌ 抛出异常"]
    
    classDef process fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef success fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:2px
    
    class A4,B4,C4 process
    class D4 decision
    class E4,G4 success
    class F4,H4 error
```

## 数据流转架构图

```mermaid
flowchart LR
    subgraph "📊 数据源"
        A["📝 训练数据队列<br/>dataset_trainings"]
    end
    
    subgraph "🔄 处理层"
        B["⚙️ generateVector<br/>队列处理器"]
        C["🎯 向量生成<br/>getVectorsByText"]
        D["💾 数据插入<br/>insertData2Dataset"]
    end
    
    subgraph "💾 存储层"
        E["📋 MongoDB<br/>dataset_datas"]
        F["🎯 向量数据库<br/>PG/OceanBase/Milvus"]
    end
    
    subgraph "📊 监控层"
        G["💰 使用量统计<br/>wallet_usage"]
        H["📝 日志记录<br/>system_logs"]
    end
    
    A --> B
    B --> C
    C --> D
    D --> E
    D --> F
    B --> G
    B --> H
    
    classDef source fill:#e3f2fd,stroke:#0277bd,stroke-width:2px
    classDef process fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef storage fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef monitor fill:#fff3e0,stroke:#e65100,stroke-width:2px
    
    class A source
    class B,C,D process
    class E,F storage
    class G,H monitor
```

## 关键技术特性

### 🔄 并发控制
- 全局队列长度限制
- 乐观锁防止重复处理
- 任务锁定时间管理

### 💾 数据一致性
- MongoDB事务支持
- 原子性操作保证
- 错误回滚机制

### 🎯 性能优化
- 批量向量生成(每批20个)
- 异步处理机制
- 智能重试策略

### 📊 监控统计
- Token使用量记录
- 详细日志追踪
- 错误信息统计

## 错误处理机制

```mermaid
flowchart TD
    A["❌ 发生错误"] --> B{"🔍 错误类型判断"}
    B -->|"积分不足"| C["💰 TeamErrEnum.insufficientPoints"]
    B -->|"数据不存在"| D["📝 删除训练任务"]
    B -->|"向量生成失败"| E["🔄 重试机制"]
    B -->|"数据库错误"| F["🔄 事务回滚"]
    
    C --> G["📝 记录错误信息"]
    D --> G
    E --> H{"🔢 重试次数检查"}
    F --> G
    
    H -->|"未超限"| I["⏰ 延迟重试"]
    H -->|"已超限"| G
    
    I --> J["🔄 重新加入队列"]
    G --> K["📊 更新统计信息"]
    
    classDef error fill:#ffebee,stroke:#c62828,stroke-width:2px
    classDef process fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#e65100,stroke-width:2px
    
    class A,C,D,F,G error
    class I,J,K process
    class B,H decision
```

---

*本文档基于 FastGPT 源码分析生成，详细展示了训练数据向量化的完整流程。*