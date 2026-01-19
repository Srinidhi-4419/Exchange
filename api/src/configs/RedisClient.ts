import Redis from "ioredis";

const REDIS_URL = "redis://localhost:6379";

class RedisClient {
  private static instance: RedisClient;
  private client: Redis;

  private constructor() {
    this.client = new Redis(REDIS_URL);

    this.client.on("connect", () => {
      console.log("[Redis] connected");
    });

    this.client.on("error", (err) => {
      console.error("[Redis] error", err);
    });
  }

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  /**
   * Push command to order queue (CREATE / CANCEL)
   */
  public async pushToOrderQueue(event: any): Promise<void> {
    await this.client.rpush(
      "queue:orders:BTC_USDT",
      JSON.stringify(event)
    );
  }
}

export default RedisClient;
