import Limit from './limit';

export interface Options {
    debug?: boolean;
    isReconnect?: boolean;
    buffer?: boolean;
    autoEmitBuffer?: boolean;
    heartRateOptions?: { rate?: number; type?: string };
    reconnectionTryNum?: number;
	maxRetries?: number;
}

export interface SubOptions {
    url: string;
	method?: string;
    headers?: UTSJSONObject;
}

export interface BufferOptions {
    event: string;
    data: any;
}

export default class Socket {
    private debug: boolean;
    private url?: string;
    private headers?: UTSJSONObject;
    private buffer: boolean;
    private onRegister: { [key: string]: Array<any> } = {};
    private isError: boolean;
    private isClosed: boolean;
    private isReconnect: boolean;
    private isConnected: boolean;
    private bufferRegister: Set<BufferOptions> = new Set();
    private autoEmitBuffer: boolean;
    private beginReconnection: boolean;
    private heartRate: number;
    private heartRateType: string;
    private reconnectionTryNum: number;
    private reconnectionNum: number;
    private reconnectionTimer: number | null = null;
    private heartRateInterval: number | null = null;
    private retryInterval: number | null = null;
    private maxRetries: number;
    private socketTask: any;
    private limit: Limit;

    constructor(options: Options = {}) {
        const {
            debug = false,
            isReconnect = true,
            buffer = true,
            autoEmitBuffer = false,
            heartRateOptions = {},
            reconnectionTryNum = 0,
			maxRetries = 28,
        } = options;

        this.debug = debug;
        this.buffer = buffer;
		this.maxRetries = maxRetries;
        this.isReconnect = isReconnect;
        this.autoEmitBuffer = autoEmitBuffer;
        this.reconnectionTryNum = reconnectionTryNum || 0;
        this.heartRate = (heartRateOptions.rate && heartRateOptions.rate > 0) ? heartRateOptions.rate : 50000;
        this.heartRateType = heartRateOptions.type || 'heart';

        this.isError = false;
        this.isClosed = false;
        this.isConnected = false;
        this.beginReconnection = false;
        this.reconnectionNum = 0;
		
        this.limit = new Limit(5);
    }

    init(opts: SubOptions) {
		if (!opts.url) {
			this.log('error', 'Invalid options, URL required');
			return;
		}
		
		// 非debug模式提示使用wss协议
		if (!this.debug && !opts.url.startsWith('wss://')) {
			// this.log('info', 'WebSocket URL must use WSS protocol');
			this.log('info', 'WebSocket recommends using the more secure wss protocol');
		}
		
        this.url = opts.url;
        this.headers = opts.headers;

        if (this.reconnectionTimer) {
            clearTimeout(this.reconnectionTimer);
        }

        if (this.socketTask && this.socketTask.readyState === 1) {
            this.listenWebSocketEvent();
            return;
        }

        try {
            this.socketTask = uni.connectSocket({
				url: opts.url,
				method: 'GET',
				header: opts.headers || null,
				success() { }
			} as ConnectSocketOptions);

            this.listenWebSocketEvent();
        } catch (err) {
            this.reconnection();
        }
    }

    on(event: string, handler: any, data?: any, single: boolean = false) {
        const eventType = this.getType(event);
        if (eventType === 'string' && eventType.trim() !== '') {
            if (this.onRegister[event] === undefined) {
                this.onRegister[event] = [];
            }

            if (single && this.onRegister[event].includes(handler)) {
				return this.log('info', `Socket, 当前「${event}」事件已被注册...`);
            }

            this.onRegister[event.trim()].push(handler);
            this.log('info', 'Socket, Register[' + event + ']: ', this.onRegister[event].length);
			
            if (data) {
                this.emit(event, data);
            }
        }
    }

    off(event: string, handler?: any, isUnsubscribe: boolean = true, data?: any) {
        const handlers = this.onRegister[event] || [];
        
        if (handler) {
            this.onRegister[event] = handlers.filter(h => h !== handler);
        } else {
            delete this.onRegister[event];
        }
		
		// 向服务端发送退订
		if(isUnsubscribe) {
			this.emit('un' + event, data || '');
		}
		
        this.log('info', 'Socket, Off[' + event + ']', handler.name || handler, data || '');
        return true;
    }

    emit(event: string, data?: any) {
        if (this.getType(event) === 'object' && this.getType(data) === 'string') {
            let e = data;
            data = event;
            event = e;
        }
		
        this.sendMessage({
            event: event,
            data: data,
        });
    }

    sendMessage(message: { event: string; data: any }) {
        if (this.socketTask && this.socketTask.readyState === 1) {
			const start = Date.now();
			this.limit.run(() => {
				return new Promise<void>((resolve, reject) => {
					// message.data没传入时, 剔除
					const { data, ..._message } = message;
					const newMessage = data === null || data === '' ? _message : { ..._message, data };
					this.socketTask.send({
						data: JSON.stringify(newMessage),
						success: () => {
							this.logPerformance('Send message', start);
							// 检查是否存在缓冲区中, 从缓冲区中删除已成功发送的消息
							if (this.bufferRegister.has(message)) {
								this.bufferRegister.delete(message);
							}
							resolve();
						},
						fail: (err: any) => {
							this.log('error', 'Send message error', err);
							this.addBuffer(message);
							reject(err);
						}
					});
				});
            }).catch((err: any) => {
                this.log('error', 'Failed to send message', err);
            });
			
            return true;
        }
		
		this.addBuffer(message);
    }
	
    getState() {
		// 未初始化返回0, 重连中2, 成功连接1, 连接出错3
        return this.beginReconnection ? 2 : this.isConnected ? 1 : this.isError ? 3 : 0;
    }
	
	removeEvent(name: string) {
        delete this.onRegister[name];
    }

    close() {
        if (this.socketTask && this.isConnected) {
            this.socketTask.close();
        }
		
		this.clearTimers();
		this.clearRetryInterval();
		
		this.isClosed = true;
		this.isConnected = false;
		this.bufferRegister.clear();
    }

    killApp() {
        this.clearTimers();
		this.clearRetryInterval();
		this.bufferRegister.clear();
    }

    private addBuffer(data: BufferOptions) {
		if(!this.buffer) {
			return;
		}
		if (this.bufferRegister.has(data)) {
			return;
		}
        this.bufferRegister.add(data);
		if (!this.retryInterval) {
			this.startRetryingBufferMessages();
		}
    }
	
	/*
    private getBuffer() {
		return [...this.bufferRegister];
    }*/
	
    private sendBufferRegister() {
        if (this.isConnected) {
            this.bufferRegister.forEach((buffer) => {
                this.sendMessage(buffer);
            });
            this.bufferRegister.clear();
        }
    }
	
	private startRetryingBufferMessages() {
		if (this.retryInterval) return;
		let finds = 0;
		let retryInterval = 2000;
		this.retryInterval = setInterval(() => {
			finds++;
			if (finds > this.maxRetries || this.bufferRegister.size === 0) {
				clearInterval(this.retryInterval);
				return;
			}
			
			if (this.socketTask && this.socketTask.readyState === 1 && this.isConnected && this.bufferRegister.size > 0) {
				this.bufferRegister.forEach(buffer => {
					this.sendMessage(buffer);
				});
				finds = 0;
				retryInterval = 2000;
			} else {
				retryInterval = Math.min(retryInterval * 2, 60000);
			}
		}, retryInterval);
	}
	
    private listenWebSocketEvent() {
		this.handleOpen();
		this.handleClose();
		this.handleOnMessage();
		this.handleError();
    }

	private handleOpen() {
		this.socketTask!.onOpen(() => {
			this.isConnected = true;
			// this.handleClose();
			this.connectioned();

			if (this.autoEmitBuffer && this.bufferRegister.size > 0) {
				this.sendBufferRegister();
				this.log('info', 'Socket, Send buffer end');
			}
		});
	}
	
	private handleClose() {
	    this.socketTask!.onClose(() => {
	        if (!this.isClosed) {
	            this.reconnection();
	        }
	    });
	}
	
	private handleOnMessage() {
		this.socketTask!.onMessage((msg: any) => {
			try {
				const data = JSON.parse(msg.data);
				if (data && data['ch'] && data['data']) {
					this.emitToClientAllEvent(msg);
					this.emitMessageToTargetEventByName(data['ch'], data['data']);
				} else {
					this.emitToClientNotNameEvents(msg);
				}
			} catch (e) {
				this.log('error', 'Parse message error', e);
				this.emitToClientNotNameEvents(msg);
			}
		});
	}

	private handleError() {
		this.socketTask!.onError((res: any) => {
			if (!this.beginReconnection) {
				this.error(res);
			} else {
				this.reconnectionError(res);
			}

			this.reconnection();
		});
	}

    private clearTimers() {
		if (this.heartRateInterval) {
			clearTimeout(this.heartRateInterval);
			this.heartRateInterval = null;
		}
		if (this.reconnectionTimer) {
			clearTimeout(this.reconnectionTimer);
			this.reconnectionTimer = null;
		}
    }
	
    private clearRetryInterval() {
		if (this.retryInterval) {
			clearInterval(this.retryInterval);
			this.retryInterval = null;
		}
    }

    private reconnection() {
        if (!this.isReconnect) {
            return false;
        }

        this.isConnected = false;
        if (this.reconnectionNum >= this.reconnectionTryNum) {
            this.beginReconnection = false;
            this.log('info', 'Socket, Reconnection times are exhausted, give up reconnection');
            return false;
        }

        if (!this.isClosed) {
            this.reconnectionNum++;
            this.reconnectionTimer = setTimeout(() => {
                this.beginReconnection = true;
                this.init({
                    url: this.url,
                    headers: this.headers,
                } as SubOptions);
            }, Math.min(1000 * this.reconnectionNum, 30000));
        }
    }

    private connectioned() {
        this.isError = false;
        this.beginReconnection = false;
        this.isConnected = true;
        if (this.onRegister["connectioned"] !== undefined) {
            this.invokeHandlerFunctionOnRegister('connectioned', 'success');
        }

        this.beginSendHeartBeat();
    }

    private beginSendHeartBeat() {
        this.heartRateInterval = setInterval(() => {
            this.emit(this.heartRateType);
            this.emitMessageToTargetEventByName('HEARTBEAT', {
                msg: "Send a heartbeat to the server...",
            });
        }, this.heartRate);
    }
	
    private error(err: any) {
        this.isError = true;
        if (this.onRegister["error"] !== undefined) {
            this.invokeHandlerFunctionOnRegister("error", err);
        }
    }

    private reconnectionError(err: any) {
        this.isError = true;
        if (this.onRegister["reconnectionerror"] !== undefined) {
            this.invokeHandlerFunctionOnRegister("reconnectionerror", err);
        }
    }

    private emitMessageToTargetEventByName(name: string, data: any) {
        this.invokeHandlerFunctionOnRegister(name, data);
    }

    private emitToClientNotNameEvents(msg: any) {
        this.invokeHandlerFunctionOnRegister("**", msg);
    }

    private emitToClientAllEvent(data: any) {
        this.invokeHandlerFunctionOnRegister("*", data);
    }
    private invokeHandlerFunctionOnRegister(register: string, data: any) {
        if (this.onRegister[register] === undefined) {
            return false;
        }

        const eventList = this.onRegister[register];
        for (let i = 0; i < eventList.length; i++) {
            const event = eventList[i] || null;
            if (event && typeof event === 'function') {
                event(data);
            }
        }
    }
	
	private logPerformance(tag: string, start: number) {
		const end = Date.now();
		this.log('info', `Performance - ${tag}: ${end - start}ms`);
	}
	
    getType(o: any): string {
        if (o === null) return 'null';
        if (Array.isArray(o)) return 'array';
        return typeof o;
    }
	
    isObject(value: any): boolean {
        return value !== null && typeof value === 'object';
    }

    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
        if (this.debug) {
			const timestamp = new Date().toISOString();
			console[level](`[${timestamp}] [${level.toUpperCase()}] ${message}`, ...args);
        }
    }
}
