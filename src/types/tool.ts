export type ToolResponse = {
  content: Array<{
    type: string;
    text: string;
  }>;
};

export type BaseTool = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

export type Tool<TArgs = Record<string, unknown>> = BaseTool & {
  execute: (args: TArgs) => Promise<ToolResponse>;
};
