import { useEffect, useState } from "react";
import * as signalR from "@microsoft/signalr";
import { env } from "../config/env";

export function useSignalR<T = any>(eventName: string, callback: (data: T) => void) {
  const [connection, setConnection] = useState<signalR.HubConnection | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newConnection = new signalR.HubConnectionBuilder()
      .withUrl(env.SIGNALR_URL)
      .withAutomaticReconnect()
      .build();

    setConnection(newConnection);

    return () => {
      newConnection.stop();
    };
  }, []);

  useEffect(() => {
    if (connection) {
      connection.start()
        .then(() => {
          console.log("Connected to SignalR Hub");
          setIsConnected(true);
          connection.on(eventName, callback);
        })
        .catch(e => console.log('Connection failed: ', e));

      connection.onreconnected(() => {
        setIsConnected(true);
      });

      connection.onreconnecting(() => {
        setIsConnected(false);
      });

      connection.onclose(() => {
        setIsConnected(false);
      });

      return () => {
        connection.off(eventName, callback);
      };
    }
  }, [connection, eventName, callback]);

  return { isConnected };
}
