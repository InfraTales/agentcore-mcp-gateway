import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

export const STACK_NAME = process.env.STACK_NAME ?? 'OrdersMcpGateway';

export async function stackOutputs(): Promise<Record<string, string>> {
  const cfn = new CloudFormationClient({});
  const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const outputs = Stacks?.[0]?.Outputs ?? [];
  return Object.fromEntries(outputs.map((o) => [o.OutputKey!, o.OutputValue!]));
}
