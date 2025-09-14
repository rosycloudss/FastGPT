# FastGPT 用户认证和权限管理实现详解

## 概述

FastGPT 采用基于 JWT Token 的用户认证机制和基于角色的权限管理系统（RBAC），支持多种认证方式和细粒度的权限控制。本文档详细梳理了 FastGPT 中用户认证和权限管理功能的实现逻辑，并列举具体的代码实现位置。

## 1. 用户认证系统

### 1.1 认证方式

FastGPT 支持多种认证方式：

1. **Cookie Token 认证**：用于 Web 端用户登录
2. **API Key 认证**：用于 API 调用
3. **Root Key 认证**：系统管理员权限
4. **OAuth 登录**：第三方登录集成

### 1.2 核心认证文件

#### 1.2.1 用户登录相关 API

**文件位置：** `projects/app/src/pages/api/support/user/account/`

- **`loginByPassword.ts`**：密码登录接口
  - 实现用户名/密码验证
  - 验证码校验
  - 用户存在性检测
  - JWT Token 生成

- **`tokenLogin.ts`**：Token 登录接口
  - JWT Token 验证
  - 用户信息获取
  - 敏感信息过滤

- **`preLogin.ts`**：预登录接口
  - 验证码生成与存储
  - 登录前置验证

- **`loginout.ts`**：登出接口
  - Token 失效处理
  - 会话清理

- **`checkPswExpired.ts`**：密码过期检查

#### 1.2.2 权限认证控制器

**文件位置：** `packages/service/support/permission/controller.ts`

**核心功能：**
- `parseHeaderCert()` 函数：解析请求头中的认证信息
- 支持多种认证方式的统一处理
- JWT Token 解析和验证
- API Key 验证
- Root Key 验证
- Cookie Token 处理

**关键代码段：**
```typescript
// 认证类型枚举
enum AuthUserTypeEnum {
  token = 'token',
  apikey = 'apikey', 
  root = 'root'
}

// 统一认证入口
export async function parseHeaderCert({
  req,
  authToken = false,
  authApiKey = false,
  authRoot = false
}: AuthCertProps): Promise<AuthResponseType>
```

#### 1.2.3 认证通用函数

**文件位置：** `packages/service/support/permission/auth/common.ts`

- `authCert()` 函数：调用 parseHeaderCert 并返回认证结果
- `authRequestFromLocal()` 函数：验证本地服务请求的主机头

### 1.3 会话管理

**文件位置：** `packages/service/support/user/session.ts`

**功能实现：**
- 会话创建和存储
- 会话验证和更新
- 会话删除和清理
- 冗余会话清理机制

## 2. 权限管理系统

### 2.1 权限设计架构

FastGPT 采用基于资源的权限控制模型，主要包括：

1. **用户体系**：用户 -> 团队成员 -> 团队
2. **权限维度**：个人权限、群组权限、组织权限
3. **资源类型**：应用、知识库、工作流等
4. **权限级别**：读取、写入、管理、所有者

### 2.2 权限常量定义

**文件位置：** `packages/global/support/permission/constant.ts`

**核心内容：**
```typescript
// 认证用户类型
export enum AuthUserTypeEnum {
  token = 'token',
  apikey = 'apikey',
  root = 'root'
}

// 权限类型
export enum PermissionTypeEnum {
  private = 'private',
  public = 'public',
  inherit = 'inherit'
}

// 资源类型
export enum ResourceTypeEnum {
  team = 'team',
  app = 'app',
  dataset = 'dataset',
  plugin = 'plugin'
}

// 权限值定义
export const PermissionList = {
  owner: { value: 63, name: '所有者' },
  read: { value: 1, name: '读' },
  write: { value: 2, name: '写' },
  manage: { value: 4, name: '管理' }
};

// 角色定义
export const RoleList = {
  read: { value: 1, name: '读取' },
  write: { value: 3, name: '编辑' },
  manage: { value: 7, name: '管理' }
};
```

### 2.3 权限验证实现

#### 2.3.1 应用权限验证

**文件位置：** `packages/service/support/permission/app/auth.ts`

**功能：**
- 应用访问权限验证
- 应用操作权限检查
- 团队成员权限验证

#### 2.3.2 知识库权限验证

**文件位置：** `packages/service/support/permission/dataset/auth.ts`

**功能：**
- 知识库访问权限验证
- 数据集操作权限检查

#### 2.3.3 团队权限管理

**文件位置：** `packages/service/support/permission/teamLimit/controller.ts`

**功能：**
- 团队资源限制管理
- 团队成员权限控制
- 资源配额管理

### 2.4 资源权限表结构

**数据库表：** `resource_permissions`

**字段说明：**
- `resourceType`: 资源类型（app、dataset等）
- `resourceId`: 资源ID
- `teamId`: 团队ID
- `tmbId`: 团队成员ID
- `permission`: 权限值
- `inheritPermission`: 继承权限值

## 3. 中间件和路由守卫

### 3.1 API 中间件系统

#### 3.1.1 NextAPI 中间件入口

**文件位置：** `projects/app/src/service/middleware/entry.ts`

```typescript
import { NextEntry } from '@fastgpt/service/common/middle/entry';

export const NextAPI = NextEntry({
  beforeCallback: []
});
```

#### 3.1.2 中间件核心实现

**文件位置：** `packages/service/common/middle/entry.ts`

**功能实现：**
- 请求日志记录
- CORS 跨域处理
- 统一错误处理
- 响应时间监控
- 统一响应格式

**核心代码：**
```typescript
export const NextEntry = ({
  beforeCallback = []
}: {
  beforeCallback?: ((req: NextApiRequest, res: NextApiResponse) => Promise<any>)[];
}) => {
  return (...args: NextApiHandler[]): NextApiHandler => {
    return async function api(req: ApiRequestProps, res: NextApiResponse) {
      const start = Date.now();
      addLog.debug(`Request start ${req.url}`);

      try {
        // 执行前置回调（包括CORS处理）
        await Promise.all([
          withNextCors(req, res),
          ...beforeCallback.map((item) => item(req, res))
        ]);

        // 执行处理器链
        let response = null;
        for await (const handler of args) {
          response = await handler(req, res);
          if (res.writableFinished) {
            break;
          }
        }

        // 记录请求耗时
        const duration = Date.now() - start;
        if (duration < 2000) {
          addLog.debug(`Request finish ${req.url}, time: ${duration}ms`);
        } else {
          addLog.warn(`Request finish ${req.url}, time: ${duration}ms`);
        }

        // 统一响应格式
        const contentType = res.getHeader('Content-Type');
        if ((!contentType || contentType === 'application/json') && !res.writableFinished) {
          return jsonRes(res, {
            code: 200,
            data: response
          });
        }
      } catch (error) {
        return jsonRes(res, {
          code: 500,
          error,
          url: req.url
        });
      }
    };
  };
};
```

### 3.2 CORS 跨域处理

**文件位置：** `packages/service/common/middle/cors.ts`

**功能：**
- 跨域请求处理
- 允许的域名配置
- HTTP 方法限制
- 请求头控制

### 3.3 频率限制中间件

**文件位置：** `packages/service/common/middle/reqFrequencyLimit.ts`

**功能：**
- IP 频率限制
- QPS 控制
- 防刷机制

**使用示例：**
```typescript
// 限制每秒10次请求
export default NextAPI(useIPFrequencyLimit({
  id: 'api-name',
  seconds: 1,
  limit: 10
}), handler);
```

### 3.4 路由守卫实现

每个 API 路由都通过认证函数进行权限验证：

```typescript
// 应用权限验证示例
const { teamId, tmbId, app } = await authApp({
  req,
  authToken: true,
  appId,
  per: ManagePermissionVal
});

// 通用认证示例
const { userId, teamId, tmbId } = await authCert({
  req,
  authToken: true,
  authApiKey: true
});
```

## 4. 数据库模型

### 4.1 用户相关表结构

#### 4.1.1 用户表 (users)

**Schema 文件：** `packages/service/support/user/schema.ts`

**主要字段：**
- `_id`: 用户ID
- `username`: 用户名
- `password`: 密码（加密存储）
- `email`: 邮箱
- `avatar`: 头像
- `timezone`: 时区
- `createTime`: 创建时间
- `lastLoginTmbId`: 最后登录的团队成员ID

#### 4.1.2 团队表 (teams)

**Schema 文件：** `packages/service/support/team/schema.ts`

**主要字段：**
- `_id`: 团队ID
- `name`: 团队名称
- `ownerId`: 所有者ID
- `avatar`: 团队头像
- `createTime`: 创建时间
- `balance`: 余额
- `teamDomain`: 团队域名

#### 4.1.3 团队成员表 (team_members)

**Schema 文件：** `packages/service/support/teamMember/schema.ts`

**主要字段：**
- `_id`: 成员ID
- `teamId`: 团队ID
- `userId`: 用户ID
- `name`: 成员名称
- `role`: 角色
- `status`: 状态
- `createTime`: 加入时间
- `defaultTeam`: 是否默认团队

### 4.2 权限相关表结构

#### 4.2.1 资源权限表 (resource_permissions)

**Schema 文件：** `packages/service/support/permission/schema.ts`

**主要字段：**
- `_id`: 权限ID
- `teamId`: 团队ID
- `tmbId`: 团队成员ID
- `resourceType`: 资源类型
- `resourceId`: 资源ID
- `permission`: 权限值
- `inheritPermission`: 继承权限
- `createTime`: 创建时间

#### 4.2.2 用户认证表 (user_auths)

**Schema 文件：** `packages/service/support/user/auth/schema.ts`

**主要字段：**
- `_id`: 认证ID
- `userId`: 用户ID
- `provider`: 认证提供商
- `providerId`: 提供商用户ID
- `accessToken`: 访问令牌
- `refreshToken`: 刷新令牌
- `createTime`: 创建时间

## 5. API 接口安全

### 5.1 请求拦截器

**文件位置：** `packages/service/common/api/serverRequest.ts`

**功能：**
- 请求前置处理
- 统一请求头设置
- 超时控制
- 错误处理

### 5.2 响应拦截器

**功能：**
- 响应数据统一处理
- 错误状态码处理
- 日志记录

### 5.3 安全配置

**文件位置：** `projects/app/next.config.js`

**安全头配置：**
```javascript
async headers() {
  return [
    {
      source: '/((?!chat/share$).*)',
      headers: [
        {
          key: 'X-Frame-Options',
          value: 'DENY'
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff'
        },
        {
          key: 'X-XSS-Protection',
          value: '1; mode=block'
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin'
        }
      ]
    }
  ];
}
```

## 6. 使用示例

### 6.1 创建受保护的 API 路由

```typescript
import type { ApiRequestProps, ApiResponseType } from '@fastgpt/service/type/next';
import { NextAPI } from '@/service/middleware/entry';
import { authApp } from '@fastgpt/service/support/permission/app/auth';
import { ManagePermissionVal } from '@fastgpt/global/support/permission/constant';

async function handler(
  req: ApiRequestProps<RequestBody, RequestQuery>
): Promise<ResponseType> {
  // 权限验证
  const { teamId, tmbId, app } = await authApp({
    req,
    authToken: true,
    appId: req.body.appId,
    per: ManagePermissionVal
  });

  // 业务逻辑处理
  // ...

  return result;
}

export default NextAPI(handler);
```

### 6.2 添加频率限制

```typescript
import { useIPFrequencyLimit } from '@fastgpt/service/common/middle/reqFrequencyLimit';

export default NextAPI(
  useIPFrequencyLimit({
    id: 'create-app',
    seconds: 60,
    limit: 10
  }),
  handler
);
```

## 7. 总结

FastGPT 的用户认证和权限管理系统具有以下特点：

1. **多样化认证方式**：支持 Token、API Key、Root Key 等多种认证方式
2. **细粒度权限控制**：基于资源的权限模型，支持读、写、管理等不同权限级别
3. **中间件架构**：统一的请求处理流程，便于扩展和维护
4. **安全防护**：包含频率限制、CORS 处理、安全头配置等多重防护
5. **会话管理**：完善的会话生命周期管理和清理机制

该系统为 FastGPT 提供了强大而灵活的用户认证和权限管理能力，确保了系统的安全性和可扩展性。