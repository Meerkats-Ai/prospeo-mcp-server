#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Tool definitions
const FIND_WORK_EMAIL_TOOL: Tool = {
  name: 'prospeo_find_work_email',
  description: 'Find a work email using first name, last name, and company domain.',
  inputSchema: {
    type: 'object',
    properties: {
      first_name: {
        type: 'string',
        description: 'The first name of the person',
      },
      last_name: {
        type: 'string',
        description: 'The last name of the person',
      },
      company: {
        type: 'string',
        description: 'The domain of the company (e.g., "intercom.com")',
      }
    },
    required: ['first_name', 'last_name', 'company'],
  },
};

const FIND_DOMAIN_EMAILS_TOOL: Tool = {
  name: 'prospeo_find_domain_emails',
  description: 'Find email addresses associated with a domain.',
  inputSchema: {
    type: 'object',
    properties: {
      company: {
        type: 'string',
        description: 'The domain to search for email addresses (e.g., "intercom.com")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of email addresses to return (optional)',
      }
    },
    required: ['company'],
  },
};

const FIND_MOBILE_TOOL: Tool = {
  name: 'prospeo_find_mobile',
  description: 'Find mobile number using LinkedIn profile URL.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The LinkedIn profile URL of the person',
      }
    },
    required: ['url'],
  },
};

const VERIFY_EMAIL_TOOL: Tool = {
  name: 'prospeo_verify_email',
  description: 'Verify if an email address is valid and active.',
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'Email address to verify',
      }
    },
    required: ['email'],
  },
};

const ENRICH_FROM_LINKEDIN_TOOL: Tool = {
  name: 'prospeo_enrich_from_linkedin',
  description: 'Find work email and enrich person data from LinkedIn URL.',
  inputSchema: {
    type: 'object',
    properties: {
      linkedin_url: {
        type: 'string',
        description: 'The LinkedIn profile URL of the person',
      }
    },
    required: ['linkedin_url'],
  },
};

// Type definitions
interface FindWorkEmailParams {
  first_name: string;
  last_name: string;
  company: string;
}

interface FindDomainEmailsParams {
  company: string;
  limit?: number;
}

interface FindMobileParams {
  url: string;
}

interface VerifyEmailParams {
  email: string;
}

interface EnrichFromLinkedInParams {
  linkedin_url: string;
}

// Type guards
function isFindWorkEmailParams(args: unknown): args is FindWorkEmailParams {
  return (
    typeof args === 'object' &&
    args !== null &&
    'first_name' in args &&
    typeof (args as { first_name: unknown }).first_name === 'string' &&
    'last_name' in args &&
    typeof (args as { last_name: unknown }).last_name === 'string' &&
    'company' in args &&
    typeof (args as { company: unknown }).company === 'string'
  );
}

function isFindDomainEmailsParams(args: unknown): args is FindDomainEmailsParams {
  if (
    typeof args !== 'object' ||
    args === null ||
    !('company' in args) ||
    typeof (args as { company: unknown }).company !== 'string'
  ) {
    return false;
  }

  // Optional parameters
  if (
    'limit' in args &&
    (args as { limit: unknown }).limit !== undefined &&
    typeof (args as { limit: unknown }).limit !== 'number'
  ) {
    return false;
  }

  return true;
}

function isFindMobileParams(args: unknown): args is FindMobileParams {
  return (
    typeof args === 'object' &&
    args !== null &&
    'url' in args &&
    typeof (args as { url: unknown }).url === 'string'
  );
}

function isVerifyEmailParams(args: unknown): args is VerifyEmailParams {
  return (
    typeof args === 'object' &&
    args !== null &&
    'email' in args &&
    typeof (args as { email: unknown }).email === 'string'
  );
}

function isEnrichFromLinkedInParams(args: unknown): args is EnrichFromLinkedInParams {
  return (
    typeof args === 'object' &&
    args !== null &&
    'linkedin_url' in args &&
    typeof (args as { linkedin_url: unknown }).linkedin_url === 'string'
  );
}

// Server implementation
const server = new Server(
  {
    name: 'prospeo-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);

// Get API key from environment variables
const PROSPEO_API_KEY = process.env.PROSPEO_API_KEY;
const PROSPEO_API_URL = 'https://api.prospeo.io';
console.log(`Prospeo MCP Server initialized successfully PROSPEO_API_KEY ${PROSPEO_API_KEY}`);
// Check if API key is provided
if (!PROSPEO_API_KEY) {
  console.error('Error: PROSPEO_API_KEY environment variable is required');
  process.exit(1);
}

// Configuration for retries and monitoring
const CONFIG = {
  retry: {
    maxAttempts: Number(process.env.PROSPEO_RETRY_MAX_ATTEMPTS) || 3,
    initialDelay: Number(process.env.PROSPEO_RETRY_INITIAL_DELAY) || 1000,
    maxDelay: Number(process.env.PROSPEO_RETRY_MAX_DELAY) || 10000,
    backoffFactor: Number(process.env.PROSPEO_RETRY_BACKOFF_FACTOR) || 2,
  },
};

// Initialize Axios instance for API requests

const apiClient: AxiosInstance = axios.create({
  baseURL: PROSPEO_API_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-KEY': PROSPEO_API_KEY
  }
});

let isStdioTransport = false;

function safeLog(
  level:
    | 'error'
    | 'debug'
    | 'info'
    | 'notice'
    | 'warning'
    | 'critical'
    | 'alert'
    | 'emergency',
  data: any
): void {
  if (isStdioTransport) {
    // For stdio transport, log to stderr to avoid protocol interference
    console.error(
      `[${level}] ${typeof data === 'object' ? JSON.stringify(data) : data}`
    );
  } else {
    // For other transport types, use the normal logging mechanism
    server.sendLoggingMessage({ level, data });
  }
}

// Add utility function for delay
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Add retry logic with exponential backoff
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  attempt = 1
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const isRateLimit =
      error instanceof Error &&
      (error.message.includes('rate limit') || error.message.includes('429'));

    if (isRateLimit && attempt < CONFIG.retry.maxAttempts) {
      const delayMs = Math.min(
        CONFIG.retry.initialDelay *
          Math.pow(CONFIG.retry.backoffFactor, attempt - 1),
        CONFIG.retry.maxDelay
      );

      safeLog(
        'warning',
        `Rate limit hit for ${context}. Attempt ${attempt}/${CONFIG.retry.maxAttempts}. Retrying in ${delayMs}ms`
      );

      await delay(delayMs);
      return withRetry(operation, context, attempt + 1);
    }

    throw error;
  }
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    FIND_WORK_EMAIL_TOOL,
    FIND_DOMAIN_EMAILS_TOOL,
    FIND_MOBILE_TOOL,
    VERIFY_EMAIL_TOOL,
    ENRICH_FROM_LINKEDIN_TOOL,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startTime = Date.now();
  try {
    const { name, arguments: args } = request.params;

    // Log incoming request with timestamp
    safeLog(
      'info',
      `[${new Date().toISOString()}] Received request for tool: ${name}`
    );
safeLog(
      'info',
      `JSON arguments: ${JSON.stringify(args, null, 2)}`
    );

    if (!args) {
      throw new Error('No arguments provided');
    }

    switch (name) {
      case 'prospeo_find_work_email': {
        if (!isFindWorkEmailParams(args)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid arguments for prospeo_find_work_email'
          );
        }

        try {
          const response = await withRetry(
            async () => apiClient.post('/email-finder', {
              first_name: args.first_name,
              last_name: args.last_name,
              company: args.company
            }),
            'find work email'
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMessage = axios.isAxiosError(error)
            ? `API Error: ${error.response?.data?.message || error.message}`
            : `Error: ${error instanceof Error ? error.message : String(error)}`;

          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      }

      case 'prospeo_find_domain_emails': {
        if (!isFindDomainEmailsParams(args)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid arguments for prospeo_find_domain_emails'
          );
        }

        try {
          const requestData: any = {
            company: args.company
          };
          
          if (args.limit) {
            requestData.limit = args.limit;
          }
          
          const response = await withRetry(
            async () => apiClient.post('/domain-search', requestData),
            'find domain emails'
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMessage = axios.isAxiosError(error)
            ? `API Error: ${error.response?.data?.message || error.message}`
            : `Error: ${error instanceof Error ? error.message : String(error)}`;

          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      }
      
      case 'prospeo_find_mobile': {
        if (!isFindMobileParams(args)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid arguments for prospeo_find_mobile'
          );
        }

        try {
          const response = await withRetry(
            async () => apiClient.post('/mobile-finder', {
              url: args.url
            }),
            'find mobile number'
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMessage = axios.isAxiosError(error)
            ? `API Error: ${error.response?.data?.message || error.message}`
            : `Error: ${error instanceof Error ? error.message : String(error)}`;

          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      }
      
      case 'prospeo_verify_email': {
        if (!isVerifyEmailParams(args)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid arguments for prospeo_verify_email'
          );
        }

        try {
          const response = await withRetry(
            async () => apiClient.post('/email-verifier', {
              email: args.email
            }),
            'verify email'
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMessage = axios.isAxiosError(error)
            ? `API Error: ${error.response?.data?.message || error.message}`
            : `Error: ${error instanceof Error ? error.message : String(error)}`;

          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      }

      case 'prospeo_enrich_from_linkedin': {
        if (!isEnrichFromLinkedInParams(args)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Invalid arguments for prospeo_enrich_from_linkedin'
          );
        }

        try {
          const response = await withRetry(
            async () => apiClient.post('/social-url-enrichment', {
              url: args.linkedin_url}),
            'enrich from linkedin'
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
            isError: false,
          };
        } catch (error) {
          const errorMessage = axios.isAxiosError(error)
            ? `API Error: ${error.response?.data?.message || error.message}`
            : `Error: ${error instanceof Error ? error.message : String(error)}`;

          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      }

      default:
        return {
          content: [
            { type: 'text', text: `Unknown tool: ${name}` },
          ],
          isError: true,
        };
    }
  } catch (error) {
    // Log detailed error information
    safeLog('error', {
      message: `Request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      tool: request.params.name,
      arguments: request.params.arguments,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    });
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  } finally {
    // Log request completion with performance metrics
    safeLog('info', `Request completed in ${Date.now() - startTime}ms`);
  }
});

// Server startup
async function runServer() {
  try {
    console.error('Initializing Prospeo MCP Server...');

    const transport = new StdioServerTransport();

    // Detect if we're using stdio transport
    isStdioTransport = transport instanceof StdioServerTransport;
    if (isStdioTransport) {
      console.error(
        'Running in stdio mode, logging will be directed to stderr'
      );
    }

    await server.connect(transport);

    // Now that we're connected, we can send logging messages
    safeLog('info', 'Prospeo MCP Server initialized successfully');
    safeLog('info', `API Key: ${PROSPEO_API_KEY}`);
    safeLog(
      'info',
      `Configuration: API URL: ${PROSPEO_API_URL}`
    );

    console.error('Prospeo MCP Server running on stdio');
  } catch (error) {
    console.error('Fatal error running server:', error);
    process.exit(1);
  }
}

runServer().catch((error: any) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
