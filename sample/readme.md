# Node SMTP Server

## Description

This is a simple SMTP server that listens on port 25 and prints out the email message to the console.

## Installation

```bash
npm install
```

## Running Server

Running on default port

```bash
npm start
```

Running on custom port

```bash
PORT=<PORT_NUMBER> npm start
```

## Running Client

Connect client to default localhost and port

```bash
npm run start:client
```

Connect client to custom host and port

```bash
HOST=<HOST_NAME> PORT=<PORT_NUMBER> npm run start:client
```
