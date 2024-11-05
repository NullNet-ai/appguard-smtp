import {AppGuardTcpInfo} from "./proto/appguard/AppGuardTcpInfo";

export type TCPSession = {
  id: string;
  localAddress: string;
  localPort: number;
  remoteAddress: string;
  remotePort: number;
  transmissionType: string;
  hostNameAppearsAs: string;
  tcpInfo?: AppGuardTcpInfo;
};

export type CallbackFunction = (error?: null | Error, data?: any) => void;

export type SMTPAuth = {
  method: 'PLAIN' | 'LOGIN' | 'XOAUTH2';
  username: string;
  password: string;
  accessToken?: string;
  validatePassword?: (password: string) => boolean;
};
