import Redis from 'ioredis';
import { MessageToApi } from './types/toapi';
class RedisManager{
    private client:Redis;
    private static instance:RedisManager;

    private constructor(){
        this.client=new Redis();
        this.client.on("connect",()=>{
            console.log("Redis is connected");
        }
        )
        this.client.on("error",()=>{
            console.log("Error while connecting redis client");
        })
    }

    public static getInstance(){
        if(!this.instance){
            this.instance=new RedisManager();
        }
        return this.instance;
    }
    public sendtoQueue(clientId:string,message:MessageToApi){
        this.client.rpush(clientId,JSON.stringify(message));
    }
     public sendToApi(clientId: string, message: MessageToApi) {
        this.client.publish(clientId, JSON.stringify(message));
    }
}
export default RedisManager;