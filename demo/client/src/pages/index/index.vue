<template>
    <view class="content">
        <div class="msg-box">
            <div v-for="(item, index) in list" :key="index">服务器消息：{{ item.msg }}</div>
        </div>
        <input placeholder="输入消息" v-model="msg" class="message-box box" />
        <div class="bottom">
            <button @click="sendData" class="box">发送文本框数据</button>
            <button @click="sendDirty" class="box">接收脏数据</button>
        </div>
    </view>
</template>

<script>
export default {
    data() {
        return {
            title: 'Hello',
            msg: '',
            list: []
        };
    },
    onLoad() {
        // 绑定reply-success-hello事件同时, 使用reply-success-hello订阅id=1001的信息
        // 前端也可以加命名空间reply-success-hello@namesapce这样就可以使用相同的事件订阅不同的接口内容
        // 命名空间后端需要在解析指向功能时去掉, 但是返回数据时需要带命名空间, 用以接收数据
        this.$socket.on('reply-success-hello', this.reply, true, {"id": 1001});
    },
    onUnload() {
        // 这里注销相同的event, 同时发送一条unreply-success-hello={"id": 1001}的消息进行取消订阅
        this.$socket.off('reply-success-hello', this.reply, , {"id": 1001});
    },
    methods: {
        reply(data) {
            this.list.push(data);
            console.log('reply: ', data);
        },
        /// 发送数据到服务端
        sendData() {
            this.$socket.emit('hello', { msg: this.msg });
        },
        /// 通知服务端发送脏数据
        sendDirty() {
            this.$socket.emit('dirty-data', {});
        }
    }
};
</script>

<style>
.bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.box {
    height: 80rpx;
    padding: 0 20rpx;
    background-color: #fff;
    border-radius: 10rpx;
    border: 1px solid #bababa;
}

.message-box {
    flex: 1;
    margin-right: 30rpx;
}

.content {
    padding: 30rpx;
    bottom: 0;
    display: flex;
    width: 750rpx;
    flex-direction: column;
    box-sizing: border-box;
}

.msg-box {
    flex: 1;
    height: max-content;
    height: 1024rpx;
}
</style>
