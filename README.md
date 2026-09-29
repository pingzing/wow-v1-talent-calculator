# WoW v1 Talent Calculator

It's a talent calculator for all classes in World of Warcraft as they were at release (or as near as I could determine).

These talents predate all the class reworks that began in v1.6.0 and concluded in v1.12.0.

If you want to see it running, it can be viewed at [https://www.travelneil.com/static-html/vanilla-wow-v1-talent-calc/index.html](https://www.travelneil.com/static-html/vanilla-wow-v1-talent-calc/index.html).

## Running

Simply clone and open `index.html` in a browser.

## Deploying

Deploy the contents of the repository, except for the `/tools` directory and the README.

## Building

- Requires PowerShell

The repository already includes a prebuilt `index.html`. But if you want to make any changes, you can modify the talents in `/data/className.json`, then regenerate the `index.html` file.

Then, run `tools/build.ps1` to regenerate `index.html`.
