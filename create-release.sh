#!/bin/bash

set -e

echo "This script will create a live-image-resizer release, based of the current 'develop' branch."
echo "Press Ctrl-C to cancel"
echo

CURRENT_BRANCH=`git rev-parse --abbrev-ref HEAD`
if [ "${CURRENT_BRANCH}" != "develop" ]; then
	echo "Please ensure you are on the 'develop' with a clean workspace"
	exit 1
fi

echo "I'll now clean your workspace"
git checkout . > /dev/null
git pull > /dev/null

echo "Whats the version number associated with this release? Type the version number followed by [enter]. "
read VERSION

git checkout master > /dev/null
git pull > /dev/null
git rebase develop > /dev/null
git tag -a $VERSION -m "Public release of version ${VERSION}"
git push > /dev/null
git push --tags > /dev/null

echo "Version ${VERSION} was succesfully released. On Github you can complete the release: https://github.com/inventid/live-image-resize/releases/tag/${VERSION}"
git checkout develop > /dev/null
exit 0


