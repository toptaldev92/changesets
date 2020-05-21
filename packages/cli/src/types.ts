import { AccessType } from "@changesets/types";

export type CliOptions = {
  commit?: boolean;
  changelog?: string;
  access?: AccessType;
  sinceMaster?: boolean;
  verbose?: boolean;
  output?: string;
  otp?: string;
  empty?: boolean;
  since?: string;
  snapshot?: string | boolean;
  tag?: string;
};

export type CommandOptions = CliOptions & {
  cwd: string;
};
