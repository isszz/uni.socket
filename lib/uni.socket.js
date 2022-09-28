/*
 * @Author: UpYou
 * @Date: 2020-12-25 9:14:50
 * @LastEditTime: 2022-09-20 17:39:12
 * @Description: uni.socket plug-in is developed based on uniapp...
 */

export default class Socket {
    constructor(options = {}) {
        // 是否启用debug模式
        this._debug = options.debug || process.env.NODE_ENV === 'development'
        // websocket链接
        this._url = options.url
        // 是否设置重新连接
        this._reconnection = options.reconnection || true
        // 是否建立缓存池,默认true，如果建立缓存池，会将因为程序错误导致未发送成功的消息发送
        this._buffer = options.buffer || true
        /// on方法注册的事件
        this.on_register = {}
        // 是否已成功连接
        this._connectioned = false
        // 缓存池
        this._buffer_register = []
        // 发送缓存池的数据
        this._auto_emit_buffer_data = options.autoEmitBuffer || false
        // 被动断开
        this.closed = false
        // 开始重连
        this.begin_reconnection = false
        // 多少毫秒发送一次心跳
        this._heart_rate = options.heartRate > 0 ? options.heartRate : 60000
        // 后端心跳字段
        this._heart_rate_type = options.heartRateType || 'heart'
        // 尝试重连次数
        this._reconnection_try_num = options.reconnectionTryNum || null
        this._reconnection_num = 0
        this._is_add_buffer = []

        this.init()
    }

    /**
     * 注册一个事件
     * @param {Object} event  事件
     * @param {Object} handler 事件处理者
     * @param {Boolean} single 此handler是否只处理一次
     * @param {Any} data 注册事件后需要发送的收据
     */
    async on(event, handler, single = false, data) {
        const eType = await this.getType(event)
        if (eType === "[object String]" && eType.trim() !== "") {
            if (this.on_register[event] == void 0) {
                this.on_register[event] = []
            }

            if (single) {
                for (let i = 0; i < this.on_register[event].length; i++) {
                    if (handler === this.on_register[event][i]) {
                        return this.log(`Socket, 当前「${event}」事件已被注册...`)
                    }
                }
            }

            // 注册事件
            this.on_register[event.trim()].push(handler)
            this.log('Socket, Register[' + event + ']: ', this.on_register[event].length)

            if (data) {
                this.emit(event, data)
            }
        }
    }

    /**
     * 注销监听
     */
    off(event, handler, data) {
        const handlers = this.on_register
        for (var property in handlers) {
            if (handlers.hasOwnProperty(property)) {
                delete handlers[property]
            }
        }

        if (data) {
            this.emit('un' + event, data)
        }

        this.log('Socket, Off[' + event + ']', data)

        return this.off
    }


    /**
     * 发送消息
     */
    async emit(event, data) {
        if (this.getType(event) === "[object Object]" && this.getType(event) === "[object String]") {
            let e = data
            data = event
            event = e
        }

        const da = {
            event: event,
            data: data,
        }

        const send = (da) => {
            this.SocketTask.send({
                data: JSON.stringify(da),
                fail: (e) => {
                    // 消息发送失败时将消息缓存
                    this.addBuffer(da)
                    throw new UniSocketError("Failed to send message to server... " + e)
                },
            })
        }

        if (this.SocketTask) {
            send(da)
        } else {
            // this.log('Socket not init', this._connectioned)
            let _this = this,
                finds = 0,
                isAddBuffer = []
            let socketInitTimer = setInterval(() => {
                finds++

                if (finds > 28) {
                    clearInterval(socketInitTimer)
                    return false
                    // throw new UniSocketError('The socket is not initialization or connection error!')
                }

                // this.log('Socket init ing', _this._connectioned)
                if (this.SocketTask) {
                    finds = 0
                    clearInterval(socketInitTimer)
                    if(!_this._is_add_buffer[event]) {
                        send(da)
                    }
                    // _this.log('Socket init end', _this._connectioned)
                } else {
                    if(_this._is_add_buffer[event]) {
                        return false
                    }
                    _this._is_add_buffer[event] = true
                    // 消息发送失败时将消息缓存
                    _this.addBuffer(da)
                }
            }, 100)
        }
    }

    /**
     * 移除指定注册的事件
     * @param {Object} name 事件名称
     */
    async removeEventByName(name) {
        return Promise.then(() => {
            delete this.on_register[name]
        });
    }

    /**
     * 给缓存池添加记录
     */
    async addBuffer(data = {}) {
        this._buffer_register.push(JSON.stringify(data))
    }

    /**
     * 获取缓存池
     */
    async getBuffer() {
        return this._buffer_register
    }

    /**
     * 获取连接状态
     * @return {number} 0 表示连接中，1表示连接成功，2表示重连中，3表示失败
     */
    async getState() {
        return this.begin_reconnection ? 2 : this._connectioned ? 1 : this.isError ? 3 : 0
    }

    /**
     * 关闭当前socket
     */
    async close() {
        this.closed = true;
        this.SocketTask && this._connectioned && this.SocketTask.close();
    }
    /**
     * 将缓存池的数据发送
     */
    async sendBufferRegister() {
        if (this._connectioned) {
            let backups = []
            this._buffer_register.map((buffer, i) => {
                this.SocketTask.send(buffer)
                backups = this._buffer_register.slice(i, 1)
                /*
                this.SocketTask.send({
                    data: JSON.stringify(buffer),
                    success: () => {
                        backups = this._buffer_register.slice(i, 1)
                    },
                })*/
            })
            this._buffer_register = backups
        }
    }

    /**
     * 发生错误
     * @param {Object} callback
     */
    async error(err) {
        this.isError = true
        if (this.on_register["error"] !== undefined) {
            this.invokeHandlerFunctionOnRegistr("error", err)
        }
    }

    /**
     * 重新连接错误
     * @param {Object} err 错误信息
     */
    async reconnectionError(err) {
        this.isError = true
        if (this.on_register["reconnectionerror"] !== undefined) {
            this.invokeHandlerFunctionOnRegistr("reconnectionerror", err)
        }
    }

    /**
     * 连接成功
     */
    async connectioned() {
        this.isError = false
        // 关闭重连状态
        this.begin_reconnection = false
        this._connectioned = true
        if (this.on_register["connectioned"] !== undefined) {
            this.invokeHandlerFunctionOnRegistr("connectioned")
        }
        // 给服务器发送心跳
        this.beginSendHeartBeat()
    }

    /**
     * 开始发送心跳
     */
    async beginSendHeartBeat() {
        this._heart_rate_interval = setInterval((res) => {
            this.emit(this._heart_rate_type, { token: null })
            this.emitMessageToTargetEventByName("HEARTBEAT", {
                msg: "Send a heartbeat to the server...",
            });
        }, this._heart_rate)
    }

    /**
     * 将心跳结束
     */
    async killApp() {
        this._heart_rate_interval && clearInterval(this._heart_rate_interval)
    }

    /**
     * 重连socket
     */
    async reconnection() {
        // 处于与服务器断开状态并且不是被动断开
        this._connectioned = false
        if (this._reconnection_num >= this._reconnection_try_num) {
            this.begin_reconnection = false
            this.log('Socket, Reconnection times are exhausted, give up reconnection')
            return false
        }

        if (!this.closed) {
            this._reconnection_num++
            this.reconnection_time = setTimeout(() => {
                this.begin_reconnection = true
                this.init()
            }, 1000)
        }
    }

    /**
     * 初始化程序
     */
    async init() {
        // 是否有重连任务
        if (this.reconnection_time) {
            clearTimeout(this.reconnection_time)
        }

        // 创建一个socket对象,返回socket连接
        const SocketTask = uni.connectSocket({
            url: this._url,
            success: () => { },
        })

        // 打开连接的监听
        SocketTask.onOpen(() => {
            this.SocketTask = SocketTask
            // 标记已成功连接socket
            this._connectioned = true

            SocketTask.onClose(() => {
                // 重新连接
                if (!this.closed) {
                    this.reconnection()
                }
            })

            this.connectioned()

            // 发送缓存池中的数据
            if (this._auto_emit_buffer_data && this._buffer_register && this._buffer_register.length) {
                this.sendBufferRegister()
                this.log('Socket, Send buffer end')
            }
        });

        SocketTask.onMessage((msg) => {
            try {
                const data = JSON.parse(msg.data)
                if (data['ch'] && data['data']) {
                    this.emitToClientAllEvent(msg)
                    this.emitMessageToTargetEventByName(data['ch'], data['data'])
                } else {
                    this.emitToClientNotNameEvents(msg)
                }
            } catch (e) {
                // 服务器发来的不是一个标准的数据
                this.emitToClientNotNameEvents(msg)
            }
        });

        /// 连接打开失败
        SocketTask.onError((res) => {
            // 不在重连状态
            if (!this.begin_reconnection) {
                this.error(res)
            } else {
                this.reconnectionError(res)
            }

            // 重新连接
            this.reconnection()
        });
    }

    /**
     * 给指定的事件发送消息
     * @param {Object} name 事件名称
     */
    async emitMessageToTargetEventByName(name, data) {
        this.invokeHandlerFunctionOnRegistr(name, data)
    }

    /**
     * 使用on(**)注册的事件
     */
    async emitToClientNotNameEvents(msg) {
        this.invokeHandlerFunctionOnRegistr("**", msg)
    }

    /**
     * 使用on(*)注册的事件
     */
    async emitToClientAllEvent(data) {
        this.invokeHandlerFunctionOnRegistr("*", data)
    }

    /**
     * 获取对象类型
     * @param {Object} o 需要验证的对象
     */
    async getType(o) {
        return Object.prototype.toString.call(o)
    }

    /**
     * 给指定的事件发送数据
     * @param {Object} register 事件
     * @param {Object} data 需要发送的数据
     */
    async invokeHandlerFunctionOnRegistr(register, data) {
        if (this.on_register[register] !== undefined) {
            const eventList = this.on_register[register]
            for (var i = 0; i < eventList.length; i++) {
                const event = eventList[i]
                event(data)
            }
        }
    }

    log(...params) {
        this._debug && console.log(...params)
    }
}

// 自定义Error
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})()

var UniSocketError = /** @class */ (function (_super) {
    __extends(UniSocketError, _super);
    function UniSocketError(message) {
        var _this = _super.call(this, message) || this;
        _this.name = 'UniSocketError';
        return _this;
    }
    return UniSocketError;
}(Error))
