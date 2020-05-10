# Push

[![Continuous Integration](https://github.com/chiffre-io/template-library/workflows/Continuous%20Integration/badge.svg?branch=next)](https://github.com/chiffre-io/template-library/actions)
[![Coverage Status](https://coveralls.io/repos/github/chiffre-io/template-library/badge.svg?branch=next)](https://coveralls.io/github/chiffre-io/template-library?branch=next)
[![Dependabot Status](https://api.dependabot.com/badges/status?host=github&repo=chiffre-io/template-library)](https://dependabot.com)

Microservice to collect encrypted analytics & process metadata.

## Chiffre.io Transparency Initiative

This service is where the encrypted visitor data arrives on the Chiffre
analytics platform. As we believe transparency is paramount in providing
a privacy-first service, we're keeping this repository public as a "no trick
up our sleeve" promise.

Here, most events are collected using two methods:

- POST with the encrypted payload in the body
- GET with the encrypted paylaod in a query string argument

The first one is preferred by the tracker script, and uses either `fetch`
or `sendBeacon`, depending on context and availability.

If neither are available or fail, the tracker script falls back to an
`<img>` tag, which uses the GET route with the payload in the query
string.

#### Noscript

Clients without JavaScript enabled cannot generate end-to-end encrypted
payloads. In order to count them in without revealing too much, we
[generate an encrypted message](https://github.com/chiffre-io/push/blob/f70ef57909b72fe8c17f80f7bfcc86a13b212936/src/routes/%5BprojectID%5D.ts#L296-L332)
on the fly on the server on their behalf, containing only the following
information:

- Event type (`session:noscript`)
- Time of the request
- Country of origin (2-letter ISO country code, given by CloudFlare)

That's it. We explicitly do not reveal the path or user-agent, even
though we technically could, as a desire to respect the visitor's
privacy (we consider disabling JavaScript as the ultimate protection
against tracking).
