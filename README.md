* This project is a sub-project of XRCLOUD (https://xrcloud.app), an open-source project that aimed to provide membership-based cloud services for Hubs' Room and Scene resources, by forking the [hubs](https://github.com/Hubs-Foundation) project from [BELIVVR](https://belivvr.com) and developing additional features. 
  * (Korean) 본 프로젝트는 [BELIVVR](https://belivvr.com)에서 [hubs](https://github.com/Hubs-Foundation) 프로젝트를 fork하여 추가 기능을 개발하고, Hubs의 Room, Scene의 자원들을 회원제로 별도의 회원제 클라우드로 서비스를 제공하는 것을 목표 했던 XRCLOUD(https://xrcloud.app) 오픈소스 프로젝트의 서브 프로젝트 입니다.

* This repository is forked from [dialog created by hubfoundation](https://github.com/Hubs-Foundation/dialog).
  * (Korean) 본 저장소는 [hubfoundation에서 만든 hubs](https://github.com/Hubs-Foundation/hubs)를 fork한 저장소입니다.

* This Project was created as a sub-project of [hubs-all-in-one](https://github.com/belivvr/xrcloud/hubs-all-in-one/), a project that runs the hubs project created by BELIVVR on a single host. For detailed information about XRCLOUD, please refer to the [XRCLOUD project page](https://github.com/belivvr/xrcloud/blob/main/README.md).
  * (Korean) 본 프로젝트는 BELIVVR 에서 만든 hubs프로젝트를 단일 호스트에서 실행하는 프로젝트 [hubs-all-in-one](https://github.com/belivvr/xrcloud/hubs-all-in-one/)의 서브 프로젝트로 만들었습니다. XRCLOUD의 상세한 설명은 [XRCLOUD 프로젝트 페이지](https://github.com/belivvr/xrcloud/blob/main/README_ko.md)를 참고 바랍니다.

* As of February 2025, BELIVVR is releasing this as open source (https://github.com/belivvr/xrcloud) as the company will not be proceeding with further development due to operational difficulties.
  * 2025년 2월, BELIVVR는 기업의 운영이 어려워 추가 개발을 진행하지 않으므로 오픈 소스(https://github.com/belivvr/xrcloud)로 공개 합니다.

* For additional inquiries, please contact the former CEO of BELIVVR, Luke Yang (fstory97@gmail.com).
  * (Korean) 추가 문의는 BELIVVR의 대표 였던 양병석 대표(fstory97@gmail.com)에게 문의 바랍니다.

* Below is the original README.md at the time of forking.
  * (Korean) 아래는 fork할 당시 원본 README.md 입니다.

# [Mozilla Hubs](https://hubs.mozilla.com/)

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0) [![Build Status](https://travis-ci.org/mozilla/hubs.svg?branch=master)](https://travis-ci.org/mozilla/hubs) [![Discord](https://img.shields.io/discord/498741086295031808)](https://discord.gg/CzAbuGu)

The client-side code for [Mozilla Hubs](https://hubs.mozilla.com/), an online 3D collaboration platform that works for desktop, mobile, and VR platforms.

[Learn more about Hubs](https://hubs.mozilla.com/docs/welcome.html)

## Getting Started

If you would like to run Hubs on your own servers, check out [Hubs Cloud](https://hubs.mozilla.com/docs/hubs-cloud-intro.html).

If you would like to deploy a custom client to your existing Hubs Cloud instance please refer to [this guide](https://hubs.mozilla.com/docs/hubs-cloud-custom-clients.html).

If you would like to contribute to the main fork of the Hubs client please see the [contributor guide](./CONTRIBUTING.md).

If you just want to check out how Hubs works and make your own modifications continue on to our Quick Start Guide.

### Quick Start

[Install NodeJS](https://nodejs.org) if you haven't already. We use 16.16.0 on our build servers. If you work on multiple javascript projects it may be useful to use something like [NVM](https://github.com/nvm-sh/nvm) to manage multiple versions of node for you.

Run the following commands:

```bash
git clone https://github.com/mozilla/hubs.git
cd hubs
# nvm use v16.16.0 # if using NVM
npm ci
npm run dev
```

The backend dev server is configured with CORS to only accept connections from "hubs.local:8080", so you will need to access it from that host. To do this, you likely want to add "hubs.local" and "hubs-proxy.local" to the [local "hosts" file](https://phoenixnap.com/kb/how-to-edit-hosts-file-in-windows-mac-or-linux) on your computer:

```
127.0.0.1	hubs.local
127.0.0.1	hubs-proxy.local
```

Then visit https://hubs.local:8080 (note: HTTPS is required, you'll need to accept the warning for the self-signed SSL certificate)

> Note: When running the Hubs client locally, you will still connect to the development versions of our [Janus WebRTC](https://github.com/mozilla/janus-plugin-sfu) and [reticulum](https://github.com/mozilla/reticulum) servers. These servers do not allow being accessed outside of localhost. If you want to host your own Hubs servers, please check out [Hubs Cloud](https://hubs.mozilla.com/docs/hubs-cloud-intro.html).

## Documentation

The Hubs documentation can be found [here](https://hubs.mozilla.com/docs).

## Community

Join us on our [Discord Server](https://discord.gg/CzAbuGu) or [follow us on Twitter](https://twitter.com/MozillaHubs).

## Contributing

Read our [contributor guide](./CONTRIBUTING.md) to learn how you can submit bug reports, feature requests, and pull requests.

We're also looking for help with localization. The Hubs redesign has a lot of new text and we need help from people like you to translate it. Follow the [localization docs](./src/assets/locales/README.md) to get started.

Contributors are expected to abide by the project's [Code of Conduct](./CODE_OF_CONDUCT.md) and to be respectful of the project and people working on it.

## Additional Resources

* [Reticulum](https://github.com/mozilla/reticulum) - Phoenix-based backend for managing state and presence.
* [NAF Janus Adapter](https://github.com/mozilla/naf-janus-adapter) - A [Networked A-Frame](https://github.com/networked-aframe) adapter for the Janus SFU service.
* [Janus Gateway](https://github.com/meetecho/janus-gateway) - A WebRTC proxy used for centralizing network traffic in this client.
* [Janus SFU Plugin](https://github.com/mozilla/janus-plugin-sfu) - Plugins for Janus which enables it to act as a SFU.
* [Hubs-Ops](https://github.com/mozilla/hubs-ops) - Infrastructure as code + management tools for running necessary backend services on AWS.

## Privacy

Mozilla and Hubs believe that privacy is fundamental to a healthy internet. Read our [privacy policy](https://www.mozilla.org/en-US/privacy/hubs/) for more info.


## License

Hubs is licensed with the [Mozilla Public License 2.0](./LICENSE)

