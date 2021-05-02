import { join } from "path";
import semver from "semver";
import chalk from "chalk";
import { AccessType } from "@changesets/types";
import { Package } from "@manypkg/get-packages";
import { info, warn } from "@changesets/logger";
import { PreState } from "@changesets/types";
import * as npmUtils from "./npm-utils";
import { TwoFactorState } from "../../utils/types";
import isCI from "../../utils/isCI";

type PublishedState = "never" | "published" | "only-pre";

type PkgInfo = {
  name: string;
  localVersion: string;
  publishedState: PublishedState;
  publishedVersions: string[];
};

type PublishedResult = {
  name: string;
  newVersion: string;
  published: boolean;
};

function getReleaseTag(pkgInfo: PkgInfo, preState?: PreState, tag?: string) {
  if (tag) return tag;

  if (preState !== undefined && pkgInfo.publishedState !== "only-pre") {
    return preState.tag;
  }

  return "latest";
}

const isCustomRegistry = (registry?: string): boolean =>
  !!registry &&
  registry !== "https://registry.npmjs.org" &&
  registry !== "https://registry.yarnpkg.com";

const getTwoFactorState = ({
  otp,
  publicPackages
}: {
  otp?: string;
  publicPackages: Package[];
}): TwoFactorState => {
  if (otp) {
    return {
      token: otp,
      isRequired: Promise.resolve(true)
    };
  }

  if (
    isCI ||
    publicPackages.some(pkg =>
      isCustomRegistry(pkg.packageJson.publishConfig?.registry)
    ) ||
    isCustomRegistry(process.env.npm_config_registry)
  ) {
    return {
      token: null,
      isRequired: Promise.resolve(false)
    };
  }

  return {
    token: null,
    // note: we're not awaiting this here, we want this request to happen in parallel with getUnpublishedPackages
    isRequired: npmUtils.getTokenIsRequired()
  };
};

export default async function publishPackages({
  packages,
  access,
  otp,
  preState,
  tag
}: {
  packages: Package[];
  access: AccessType;
  otp?: string;
  preState: PreState | undefined;
  tag?: string;
}) {
  const packagesByName = new Map(packages.map(x => [x.packageJson.name, x]));
  const publicPackages = packages.filter(pkg => !pkg.packageJson.private);
  const twoFactorState: TwoFactorState = getTwoFactorState({
    otp,
    publicPackages
  });
  const unpublishedPackagesInfo = await getUnpublishedPackages(
    publicPackages,
    preState
  );

  if (unpublishedPackagesInfo.length === 0) {
    warn("No unpublished packages to publish");
  }

  return Promise.all(
    unpublishedPackagesInfo.map(pkgInfo => {
      let pkg = packagesByName.get(pkgInfo.name)!;
      return publishAPackage(
        pkg,
        access,
        twoFactorState,
        getReleaseTag(pkgInfo, preState, tag)
      );
    })
  );
}

async function publishAPackage(
  pkg: Package,
  access: AccessType,
  twoFactorState: TwoFactorState,
  tag: string
): Promise<PublishedResult> {
  const { name, version, publishConfig } = pkg.packageJson;
  const localAccess = publishConfig?.access;
  info(
    `Publishing ${chalk.cyan(`"${name}"`)} at ${chalk.green(`"${version}"`)}`
  );

  const publishDir = publishConfig?.directory
    ? join(pkg.dir, publishConfig.directory)
    : pkg.dir;

  const publishConfirmation = await npmUtils.publish(
    name,
    {
      cwd: publishDir,
      access: localAccess || access,
      tag
    },
    twoFactorState
  );

  return {
    name,
    newVersion: version,
    published: publishConfirmation.published
  };
}

async function getUnpublishedPackages(
  packages: Array<Package>,
  preState: PreState | undefined
) {
  const results: Array<PkgInfo> = await Promise.all(
    packages.map(async ({ packageJson }) => {
      const response = await npmUtils.infoAllow404(packageJson);
      let publishedState: PublishedState = "never";
      if (response.published) {
        publishedState = "published";
        if (preState !== undefined) {
          if (
            response.pkgInfo.versions &&
            response.pkgInfo.versions.every(
              (version: string) =>
                semver.parse(version)!.prerelease[0] === preState.tag
            )
          ) {
            publishedState = "only-pre";
          }
        }
      }

      return {
        name: packageJson.name,
        localVersion: packageJson.version,
        publishedState: publishedState,
        publishedVersions: response.pkgInfo.versions || []
      };
    })
  );

  const packagesToPublish: Array<PkgInfo> = [];

  for (const pkgInfo of results) {
    const { name, publishedState, localVersion, publishedVersions } = pkgInfo;
    if (!publishedVersions.includes(localVersion)) {
      packagesToPublish.push(pkgInfo);
      info(
        `${name} is being published because our local version (${localVersion}) has not been published on npm`
      );
      if (preState !== undefined && publishedState === "only-pre") {
        info(
          `${name} is being published to ${chalk.cyan(
            "latest"
          )} rather than ${chalk.cyan(
            preState.tag
          )} because there has not been a regular release of it yet`
        );
      }
    } else {
      // If the local version is behind npm, something is wrong, we warn here, and by not getting published later, it will fail
      warn(
        `${name} is not being published because version ${localVersion} is already published on npm`
      );
    }
  }

  return packagesToPublish;
}
