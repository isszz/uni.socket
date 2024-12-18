# uni.socket 插件API文档

### 使用

需引入并创建一个socket实例，创建完成后你将得到一个uni.socket对象

```javascript
import UniSocket from "utils/uni.socket.js"
const socket = new UniSocket({
	url: "wss://127.0.0.1/"
});
```



### 参数

| 参数           | 描述                                                         |
| -------------- | ------------------------------------------------------------ |
| url            | 服务器地址                                                   |
| reconnection   | 发送错误时是否进行重连，默认`true`                           |
| buffer         | 是否建立缓存池，当发送消息失败时会吧消息保存到缓存池等待下次发送 |
| heartRate      | 系统自动与将程序心跳发送至服务端，默认60000ms                |
| heartRateType  | 设置心跳触发的事件，默认触发`HEARTBEAT`事件                  |
| autoEmitBuffer | 是否自动发送缓存池中的数据，默认`false`                      |
| reconnectionTryNum | 尝试重连次数，默认无限重连                      |


### 方法

#### on

on方法是一个为uni.socket注册自定义事件的方法，该事件将通过你服务器传回的数据触发，因此，你服务器数据返回的格式必须遵守约定。

```javascript
socket.on('event', (data) => {
    // .... 在此处理服务器发给你的邮件data          
}, {type: 'event', data: {}}, false)
```


#### 注册事件时, 同时发送一条消息/ 可以用于订阅类
```javascript
socket.on('event', (data) => {
    // .... 在此处理服务器发给你的邮件data          
}, {event: 'event', data: {}}, true)
```

#### 第三个参数为true时, 为了使用相同的event, 也可以加命名空间例:
```
// onShow - 订阅
uni.$socket.on('sub.news.list@indexHotNewsList', this.revIndexHotNewsList, {"is_hot": 1, "order": "created", "asc": 0}, true)
// onHide - 退订, 建议在离开页面后就退订, 回到页面再订阅
uni.$socket.off('sub.news.list@indexHotNewsList', this.revIndexHotNewsList})
```
#### 命名空间在前端只是为了防止不能使用相同event订阅消息, 需要在后端拿到event后指向功能时删除@namesapce, 回调数据还是需要完整的ch=event,不然前端无法拿到数据

服务器返回的数据必须遵守该格式才能保证正常使用：

`{ch: 'event', data: {}}`

`data`未必是Object格式，它可以是任意格式，但必须拥有`ch`和`data`，`ch`是服务器与你的约定，它将去使用你注册的事件驱动，也就是说，uni.socket是通过`ch`字段来进行触发你自定义的事件驱动的。

如果你的第三个参数为`true`，那么uni.socket则会检查该事件驱动是否已被注册，如果未被注册，则将它进行注册，默认`false`

```javascript
socket.on('event', () => {} {event: 'event' data: {id: '10001'}}, true)
```

#### emit 给服务器发送消息

```javascript
socket.emit('event', {msg: "hello world"})
```

#### off 注销事件

撤销注册的事件驱动，在uni.socket中，强制每个页面退出、关闭时调用此方法，因为uni.socket无法处理移除页面存在时注册过的事件驱动从而导致的内存泄漏。
第三个参数用于注销事件时, 发送一条消息给服务器, 一般用来做业务退订, 此参数为可选参数
退订消息, 使用订阅的相同event, 会在event前加un,例如unsub.info, 后端根据此event退订相关的业务
```javascript
socket.off('event', handler)
```

例如：

```js
export default {
  methods: {
    hello() {
      ...
    }
    },
    onLoad() {
      socket.on('hello', this.hello, {event: "sub.info", data: {id: 1001}});
    },
    onUnload() {
      // 监听页面卸载
      // 页面退出，撤销hello，释放资源
      socket.off('hello', this.hello);
    }
  }
```



#### removeEventByName

移除你自定义的事件，因为是危险操作，需要开发者进行二次提交

**移除自定义事件包括任何给这个事件注册的驱动**

```javascript
socket.removeEvent('event').then(commit => {
  commit();
});
```

#### addBuffer

给缓存池添加数据

```javascript
socket.addBuffer({event: 'event', data: {}})
```

#### getBuffer

获取缓存池

```javascript
const buffer = socket.getBuffer();
// or
socket.getBuffer().then(buffer => {
	//  ...处理你的缓存池
});
```


#### getState

获取连接状态0 表示连接中，1表示连接成功，2表示重连中，3表示失败

```javascript
const state = await socket.getState();
// or
socket.getState().then(state => {
	//  ...处理你状态
});
```

#### killApp

结束心跳，心跳结束后，uni.socket除了心跳发送，在下一次发送心跳时间内，其它功能正常使用，需要后端进行处理

```javascript
socket.killApp();
```

#### close

关闭与服务器的连接，注意，它不会触发`error`事件

```javascript
socket.close();
```

### 关于心跳

uni.socket需向服务器定时发送一次心跳，其触发的事件为`HEARTBEAT`，默认心率为60000ms，服务器可根据该事件进行处理，可修改配置进行修改触发事件`heartRateType`：

```javascript
new UniSocket({
    url: "wss://127.0.0.1/",
    heartRateType: "Your event name..."
});
```

> 关于心跳会触发两次的问题，因为uni.socket发送的时候会触发一次心跳事件，而接收到服务端心跳的时候也会触发一次心跳事件。

### 系统事件

虽然是系统事件，但它和你自定义的事件并无区别，只是uni.socket赋予了它们特别的使命

| 事件              | 描述                                          | 返回值描述                   |
| ----------------- | --------------------------------------------- | ---------------------------- |
| error             | 错误事件，当socket连接发生错误时会触发        | 错误描述                     |
| reconnectionerror | 重连过程中发生的错误                          | 错误描述                     |
| connectioned      | 连接成功时触发                                | 无                           |
| \*                | 服务器给客户端发送任何消息时触发              | 客户端消息                   |
| \*\*              | 后端返回的数据格式违背与UniSocket的约定时触发 | 客户端消息                   |
| HEARTBEAT         | 每次向服务端发送一次心跳时触发                | uni.socket给你返回的垃圾消息 |




# 使用demo

若你需要查看示例，你需要启动client下的uniapp项目。项目主在main.js中使用uni.socket连接服务器，使用示例在`src/pages/index/index.vue`中


你如果没有测试服务器代码，你也可以使用node启动server文件夹下的app.js来启动一个WebSocket服务器，它监听了1200端口
