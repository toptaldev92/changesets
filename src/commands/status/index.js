/* eslint-disable consistent-return */
/* eslint-disable no-use-before-define */
import * as bolt from "bolt";
import chalk from "chalk";
import table from "tty-table";
import fs from "fs-extra";
import path from "path";

import getChangesetBase from "../../utils/getChangesetBase";
import logger from "../../utils/logger";
import getChangesets from "../../utils/getChangesets";

import createRelease from "../../utils/createRelease";

export default async function getStatus({ cwd, sinceMaster, verbose, output }) {
  const changesetBase = await getChangesetBase(cwd);
  const allPackages = await bolt.getWorkspaces({ cwd });
  const changesets = await getChangesets(changesetBase, sinceMaster);

  if (changesets.length < 1) {
    logger.error("No changesets present");
    process.exit(1);
  }

  const releaseObject = createRelease(changesets, allPackages);
  const { releases } = releaseObject;
  logger.log(
    "==================================================================="
  );

  if (output) {
    await fs.writeFile(
      path.join(cwd, output),
      JSON.stringify(releaseObject, undefined, 2)
    );
    return;
  }

  const print = verbose ? verbosePrint : SimplePrint;
  print("patch", releases);
  print("minor", releases);
  print("major", releases);

  return releaseObject;
}

function SimplePrint(type, releases) {
  const packages = releases.filter(r => r.type === type);
  if (packages.length) {
    logger.info(chalk`Packages to be bumped at {green ${type}}:\n`);

    const pkgs = packages.map(({ name }) => name).join("\n");
    logger.log(chalk.green(pkgs));
  } else {
    logger.info(chalk`{red NO} packages to be bumped at {green ${type}}`);
  }
  logger.log(
    "==================================================================="
  );
}

function verbosePrint(type, releases) {
  const packages = releases.filter(r => r.type === type);
  if (packages.length) {
    logger.info(chalk`Packages to be bumped at {green ${type}}:\n`);

    const columns = packages.map(({ name, version, changesets }) => [
      chalk.green(name),
      version,
      changesets.map(c => chalk.blue(`.changeset/${c}/changes.md`)).join(" + ")
    ]);

    const t1 = table(
      [
        { value: "Package Name" },
        { value: "New Version", width: 20 },
        { value: "Related Changeset Summaries" }
      ],
      columns,
      { paddingLeft: 0, paddingRight: 0, headerAlign: "center", align: "left" }
    );
    logger.log(t1.render());
  } else {
    logger.info(
      chalk`Running release would release {red NO} packages as a {green ${type}}`
    );
  }
  logger.log(
    "==================================================================="
  );
}
