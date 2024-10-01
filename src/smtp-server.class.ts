import { SMTPServer as NodeSMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { CallbackFunction, SMTPAuth, TCPSession } from './types';
import { Stream } from 'stream';
import {AppGuardGenericVal} from "./proto/appguard/AppGuardGenericVal";
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

const PROTO_FILE = __dirname + '/../proto/appguard.proto'
const packageDef = protoLoader.loadSync(path.resolve(__dirname, PROTO_FILE))
const grpcObj = (grpc.loadPackageDefinition(packageDef) as unknown) as ProtoGrpcType

class AppGuardService {
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
}

const headerLinesReducer = (array: Array<Record<string, string>>):  Record<string, AppGuardGenericVal> => {
  let ret_val: Record<string, string> = {}
  array.map( obj => {
    const key = obj['key']
    let value = obj['line']
    value = value.substring(key.length + 2).trim()
    return {[key]: value}
  }).forEach( obj => {
    ret_val = {...ret_val, ...obj}
  })
  return Object.entries(ret_val).reduce((acc,  current:[string, string]) => {
    const [key, value] = current
    return {
      ...acc,
      [key]: {
        stringVal: value
      }
    }
  }, {} as Record<string, AppGuardGenericVal> )
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

  constructor(port: number, appguard_host: string, appguard_port: number) {
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
    this.appguard = new AppGuardService(appguard_host, appguard_port)
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

    console.log(
      `Captured Raw SMTP Packet from ${session.remoteAddress}:${session.remotePort}`,
      smtp_packet
    );

    // @ts-ignore
    const handleSMTPRequestResponse = await this.appguard.handleSmtpRequest({
      // @ts-ignore
      headers: headerLinesReducer(smtp_packet['headerLines']),
      body: smtp_packet['text'],
      tcpInfo: session.tcpInfo
    })

    callback();
  }

  //   Invoked when a new connection is opened
  async onConnect(session: TCPSession, callback: CallbackFunction) {
    console.log(
      `Connection opened from - ${session.remoteAddress}:${session.remotePort}`
    );

    const handleTCPConnectionResponse = await this.appguard.handleTcpConnection({
      sourceIp: session.remoteAddress,
      sourcePort: session.remotePort,
      destinationIp: session.localAddress,
      destinationPort: session.localPort,
      protocol: session.transmissionType
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
    console.log(`Received email from ${session.remoteAddress}`);
    await this.onSMTPPacket(raw_smtp.toString(), session, callback);
  }

  // Invoked when connection is closed for any reason (timeout, error, etc)
  async onClose(session: TCPSession) {
    console.log(`Connection closed - ${session.remoteAddress}`);

    // @ts-ignore
    const handleSMTPResponseResponse = await this.appguard.handleSmtpResponse({
      code: undefined,
      tcpInfo: session.tcpInfo
    })
  }

  async onModuleInit() {
    this.server.listen(this.port);
    await this.appguard.onModuleInit();

    process.on('uncaughtException', (e) => {
      console.log('uncaughtException\n\r', e);
    });
  }
}
