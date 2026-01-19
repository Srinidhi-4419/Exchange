import Redis from "ioredis"
const REDIS_URL="redis://localhost:6379"
import { v4 as uuidv4 } from "uuid";
class RedisClient {
    private client:Redis;
    private publisher:Redis;
    private static instance:RedisClient;

    private constructor(){
        this.client=new Redis(REDIS_URL);
        this.client.on("connect",()=>{
            console.log("Redis is connected");
        })
        this.client.on("error",()=>{
            console.log("Error while connecting redis client");
        })
        this.publisher=new Redis(REDIS_URL);
         this.publisher.on("connect",()=>{
            console.log("publisher is connected");
        })
        this.publisher.on("error",()=>{
            console.log("Error while connecting publisher client");
        })
    }
    public static getInstance(){
        if(!this.instance){
            this.instance=new RedisClient();
        }
        return this.instance;
    }

    public sendAndawait(message:any){
        return new Promise((resolve)=>{
            const id=this.generateRandomID();
            this.client.subscribe(id,(message:any)=>{
                this.client.unsubscribe(id);
                resolve(JSON.parse(message));
            })
            this.publisher.rpush("message",JSON.stringify({clientId:id,message}));
        })
    }
    public generateRandomID(){
        const id=uuidv4();
        return id;
    }
}

export default RedisClient;