import { SMTPServer as NodeSMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { CallbackFunction, SMTPAuth, TCPSession } from './types';
import { Stream } from 'stream';
import {AppGuardClient} from "./proto/appguard/AppGuard";
import path from "path";
import {ProtoGrpcType} from "./proto/appguard";
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import {AppGuardTcpConnection} from "./proto/appguard/AppGuardTcpConnection";
import {AppGuardTcpResponse__Output} from "./proto/appguard/AppGuardTcpResponse";
import {AppGuardSmtpRequest} from "./proto/appguard/AppGuardSmtpRequest";
import {AppGuardResponse__Output} from "./proto/appguard/AppGuardResponse";
import {AppGuardSmtpResponse} from "./proto/appguard/AppGuardSmtpResponse";
import {FirewallPolicy} from "./proto/appguard/FirewallPolicy";
import {HeartbeatRequest} from "./proto/appguard/HeartbeatRequest";
import {HeartbeatResponse__Output} from "./proto/appguard/HeartbeatResponse";
import {DeviceStatus} from "./proto/appguard/DeviceStatus";
import {AppGuardFirewall, AppGuardFirewall__Output} from "./proto/appguard/AppGuardFirewall";
import {AuthHandler, TOKEN_FILE} from "./auth";

const PROTO_FILE = __dirname + '/../proto/appguard.proto'
const packageDef = protoLoader.loadSync(path.resolve(__dirname, PROTO_FILE))
const grpcObj = (grpc.loadPackageDefinition(packageDef) as unknown) as ProtoGrpcType

export type AppGuardConfig = {
  host: string;
  port: number;
  tls: boolean;
  timeout?: number;
  defaultPolicy: FirewallPolicy;
  firewall: string;
};

export class AppGuardService {
  private host: string
  private port: number
  private client: AppGuardClient

  constructor(host: string, port: number) {
    this.host = host
    this.port = port
    this.client = new grpcObj.appguard.AppGuard(`${this.host}:${this.port}`, grpc.credentials.createInsecure())
  }

  async onModuleInit() {
    return new Promise((resolve, reject) => {
      this.client?.waitForReady(Date.now() + 10000, (err) => {
        if (err) {
          console.log('Error connecting to AppGuard service')
          reject(err)
        }
        console.log('Connected to AppGuard service')
        resolve(this)
      })
    })
  }

  async handleTcpConnection(req: AppGuardTcpConnection): Promise<AppGuardTcpResponse__Output>{
    return new Promise((resolve, reject) => {
      this.client.handleTcpConnection(req, (err, res) => {
        if(err){
          reject(err)
        } else {
          resolve(res as AppGuardTcpResponse__Output)
        }
      })
    })
  }
  async handleSmtpRequest(req: AppGuardSmtpRequest): Promise<AppGuardResponse__Output>{
    return new Promise((resolve, reject) => {
      this.client.handleSmtpRequest(req, (err, res) => {
        if(err){
          reject(err)
        } else {
          resolve(res as AppGuardResponse__Output)
        }
      })
    })
  }
  async handleSmtpResponse(req: AppGuardSmtpResponse): Promise<AppGuardResponse__Output>{
    return new Promise((resolve, reject) => {
      this.client.handleSmtpResponse(req, (err, res) => {
        if(err){
          reject(err)
        } else {
          resolve(res as AppGuardResponse__Output)
        }
      })
    })
  }
  heartbeat(req: HeartbeatRequest) {
    let call = this.client.heartbeat(req);
    call.on('data', function(heartbeat: HeartbeatResponse__Output) {
      // handle the heartbeat response
      console.log("Received heartbeat from server");
      // write token to file
      const fs = require('fs');
      fs.writeFileSync(TOKEN_FILE, heartbeat.token, {flag: 'w'});
      let status = heartbeat.status;
      if (status == DeviceStatus.ARCHIVED || status == DeviceStatus.DELETED) {
        // terminate current process
        console.log("Device is archived or deleted, terminating process");
        process.exit(0);
      }
    });
    call.on('error', (_e) => {
      // An error has occurred and the stream has been closed.
      // sleep for 10 seconds and try again
      console.log("Error in heartbeat, retrying in 10 seconds");
      setTimeout(() => {
        this.heartbeat(req);
      }, 10000);
    });
  }
  async updateFirewall(req: AppGuardFirewall): Promise<AppGuardFirewall__Output>{
    return new Promise((resolve, reject) => {
      this.client.updateFirewall(req, (err, res) => {
        if(err){
          reject(err)
        } else {
          resolve(res as AppGuardFirewall__Output)
        }
      })
    })
  }
}

/*
 * SMTPServer Class
 *  Documentation: https://nodemailer.com/extras/smtp-server/
 *
 * This class is a wrapper around the NodeSMTPServer class
 * It provides a simple interface to handle SMTP events
 *
 * Usage:
 * const server = new SMTPServer(25);
 * await server.onModuleInit();
 *
 */
export class SMTPServer {
  private server: NodeSMTPServer;
  private port: number;
  private appguard: AppGuardService;
  private defaultPolicy?: FirewallPolicy;
  private timeout?: number;
  private auth: AuthHandler;
  private firewall: string;

  constructor(port: number, config: AppGuardConfig) {
    this.port = port;
    // @ts-ignore
    this.server = new NodeSMTPServer({
      secure: false,
      hideSTARTTLS: true,
      authOptional: true,
      closeTimeout: 10000,
      socketTimeout: 10000,
      onData: this.onData.bind(this),
      // @ts-ignore
      onMailFrom: this.onMailFrom.bind(this),
      // @ts-ignore
      onRcptTo: this.onRcptTo.bind(this),
      // @ts-ignore
      onAuth: this.onAuth.bind(this),
      onConnect: this.onConnect.bind(this),
      onClose: this.onClose.bind(this),
    });
    this.appguard = new AppGuardService(config.host, config.port);
    this.auth = new AuthHandler(this.appguard);

    this.defaultPolicy = config.defaultPolicy;
    this.timeout = config.timeout;
    this.firewall = config.firewall;
  }

  private firewallPromise = (promise: Promise<AppGuardResponse__Output>): Promise<AppGuardResponse__Output> => {
    if (this.timeout !== undefined && this.defaultPolicy !== undefined) {
      let timeoutPromise: Promise<AppGuardResponse__Output> = new Promise((resolve, _reject) => {
        setTimeout(resolve, this.timeout, {
          policy: this.defaultPolicy
        })
      });
      return Promise.race([promise, timeoutPromise])
    } else {
      return promise
    }
  }

  private connectionPromise = (connection: AppGuardTcpConnection): Promise<AppGuardTcpResponse__Output> => {
    let promise = this.appguard.handleTcpConnection(connection);
    if (this.timeout !== undefined) {
      let timeoutPromise: Promise<AppGuardTcpResponse__Output> = new Promise((resolve, _reject) => {
        setTimeout(resolve, this.timeout, {
          tcpInfo: {
            connection: connection,
          }
        })
      });
      return Promise.race([promise, timeoutPromise])
    } else {
      return promise
    }
  }

  private waitForData(stream: Stream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      stream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      stream.on('error', (e) => {
        reject(e);
      });
    });
  }

  async onSMTPPacket(
    packet: string,
    session: TCPSession,
    callback: CallbackFunction
  ) {
    const smtp_packet = await simpleParser(packet);

    console.log(`Captured Raw SMTP Packet from ${session.remoteAddress}:${session.remotePort}`);

    // @ts-ignore
    const handleSMTPRequestResponse = await this.firewallPromise(this.appguard.handleSmtpRequest({
      // @ts-ignore
      headers: smtp_packet['headerLines'],
      body: smtp_packet['text'],
      tcpInfo: session.tcpInfo,
      token: this.auth.token()
    }))

    if (handleSMTPRequestResponse.policy === FirewallPolicy.DENY) {
      let err = new Error('Email denied by AppGuard');
      // @ts-ignore
      err.responseCode = 541;
      callback(err);
    } else {
      callback();
    }
  }

  //   Invoked when a new connection is opened
  async onConnect(session: TCPSession, callback: CallbackFunction) {
    console.log("New TCP session from hostname:", session.hostNameAppearsAs);

    const handleTCPConnectionResponse = await this.connectionPromise({
      sourceIp: session.remoteAddress,
      sourcePort: session.remotePort,
      destinationIp: session.localAddress,
      destinationPort: session.localPort,
      protocol: session.transmissionType,
      token: this.auth.token()
    })

    session.tcpInfo = handleTCPConnectionResponse.tcpInfo

    // Callback with error to reject connection
    // callback without error to accept connection
    callback();
  }

  // Invoked when a client tries to authenticate
  async onAuth(
    _auth: SMTPAuth,
    _session: TCPSession,
    callback: CallbackFunction
  ) {
    // Callback with error to reject email
    // callback without error to accept email
    callback();
  }

  // Invoked when client sends MAIL FROM command
  async onMailFrom(
    _address: string,
    _session: TCPSession,
    callback: CallbackFunction
  ) {
    // Callback with error to reject email
    // callback without error to accept email
    callback();
  }

  // Invoked when client sends RCPT TO command
  async onRcptTo(
    _address: string,
    _session: TCPSession,
    callback: CallbackFunction
  ) {
    // Callback with error to reject email
    // callback without error to accept email
    callback();
  }

  // Invoked when client sends email data
  async onData(
    stream: Stream,
    session: TCPSession,
    callback: CallbackFunction
  ) {
    const raw_smtp = await this.waitForData(stream);
    await this.onSMTPPacket(raw_smtp.toString(), session, callback);
  }

  // Invoked when connection is closed for any reason (timeout, error, etc)
  async onClose(session: TCPSession) {
    console.log(`Connection closed - ${session.remoteAddress}:${session.remotePort}`);

    // @ts-ignore
    const handleSMTPResponseResponse = await this.firewallPromise(this.appguard.handleSmtpResponse({
      code: undefined,
      tcpInfo: session.tcpInfo,
      token: this.auth.token()
    }))
  }

  async onModuleInit() {
    this.server.listen(this.port);
    await this.appguard.onModuleInit();
    await this.auth.init();
    await this.appguard.updateFirewall({
      // @ts-ignore
      token: this.auth.token(),
      // @ts-ignore
      firewall: this.firewall
    })

    process.on('uncaughtException', (e) => {
      console.log('uncaughtException\n\r', e);
    });
  }
}
