package com.mediaflow.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.CookieManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PushbackInputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class DownloadService extends Service {
    public static final String STATUS_ACTION="com.mediaflow.app.DOWNLOAD_STATUS";
    private static final String CHANNEL="downloads",ORIGIN="https://mediaflow.local/";
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final AtomicInteger jobs=new AtomicInteger();
    private volatile int latestStart;
    private String userAgent;
    private long lastProgress;

    @Override public void onCreate(){
        super.onCreate();userAgent=android.webkit.WebSettings.getDefaultUserAgent(this);
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Downloads",NotificationManager.IMPORTANCE_LOW));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        latestStart=startId;startForeground(41,notification("Preparing download…"));
        String value=intent==null?null:intent.getStringExtra("url");jobs.incrementAndGet();
        executor.execute(()->{
            try{download(value);}catch(Exception e){status("Download failed: "+safeError(e),"");}
            finally{jobs.decrementAndGet();main.post(()->{if(jobs.get()==0)stopSelfResult(latestStart);});}
        });
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){executor.shutdownNow();super.onDestroy();}

    private Notification notification(String text){
        PendingIntent launch=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("MediaFlow").setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(launch).setOnlyAlertOnce(true).build();
    }
    private void status(String text,String uri){
        getSharedPreferences("downloads",MODE_PRIVATE).edit().putString("status",text).putString("uri",uri).apply();
        getSystemService(NotificationManager.class).notify(41,notification(text));
        sendBroadcast(new Intent(STATUS_ACTION).setPackage(getPackageName()).putExtra("status",text).putExtra("uri",uri));
    }
    private static String safeError(Exception e){String message=e.getMessage();return message==null || message.isBlank()?"Please check the link and try again.":message;}
    private static URL safeUrl(String value) throws Exception {
        URI uri=new URI(value);
        if(!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost()==null || uri.getUserInfo()!=null || value.length()>8192)throw new IOException("Invalid HTTP or HTTPS link.");
        return uri.toURL();
    }
    private HttpURLConnection connection(String value,JSONObject headers,JSONObject range) throws Exception {
        URL url=safeUrl(value);HttpURLConnection c=(HttpURLConnection)url.openConnection();
        c.setConnectTimeout(30000);c.setReadTimeout(60000);c.setInstanceFollowRedirects(true);c.setRequestProperty("User-Agent",userAgent);c.setRequestProperty("Accept","*/*");
        if(headers!=null)for(String name:new String[]{"Origin","Referer"}){String v=headers.optString(name,"");if(!v.isEmpty() && !v.contains("\r") && !v.contains("\n"))c.setRequestProperty(name,v);}
        String cookie=CookieManager.getInstance().getCookie(value);if(cookie!=null && !cookie.contains("\r") && !cookie.contains("\n"))c.setRequestProperty("Cookie",cookie);
        if(range!=null){long start=range.getLong("start"),length=range.getLong("length");if(start<0 || length<=0 || start>Long.MAX_VALUE-length)throw new IOException("Invalid stream byte range.");c.setRequestProperty("Range","bytes="+start+"-"+(start+length-1));}
        int code=c.getResponseCode();if(code<200 || code>=300){c.disconnect();throw new IOException("HTTP "+code+". Check that the video is publicly accessible, then retry.");}
        if(range!=null){String expected="bytes "+range.getLong("start")+"-"+(range.getLong("start")+range.getLong("length")-1)+"/";String actual=c.getHeaderField("Content-Range");if(code!=206 || actual==null || !actual.startsWith(expected)){c.disconnect();throw new IOException("The server did not honor a video segment range.");}}
        return c;
    }
    private byte[] readLimited(InputStream source,int limit) throws IOException {
        try(InputStream input=source;ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] buffer=new byte[8192];int n,total=0;while((n=input.read(buffer))!=-1){total+=n;if(total>limit)throw new IOException("The source response is too large.");output.write(buffer,0,n);}return output.toByteArray();
        }
    }
    private JSONObject fetchText(String value,String rawHeaders) throws Exception {
        JSONObject headers=new JSONObject(rawHeaders==null?"{}":rawHeaders);HttpURLConnection c=connection(value,headers,null);
        try{return new JSONObject().put("ok",true).put("url",c.getURL().toString()).put("text",new String(readLimited(c.getInputStream(),16*1024*1024),StandardCharsets.UTF_8));}finally{c.disconnect();}
    }
    private JSONObject resolve(String url) throws Exception {
        safeUrl(url);CountDownLatch ready=new CountDownLatch(1),complete=new CountDownLatch(1);
        String[] result={null},problem={null};WebView[] view={null};
        class Bridge {
            @JavascriptInterface public void ready(){ready.countDown();}
            @JavascriptInterface public String fetchText(String value,String headers){try{return DownloadService.this.fetchText(value,headers).toString();}catch(Exception e){try{return new JSONObject().put("ok",false).put("error",safeError(e)).toString();}catch(Exception ignored){return "{\"ok\":false}";}}}
            @JavascriptInterface public void finish(String value){result[0]=value;complete.countDown();}
        }
        main.post(()->{
            try{
                WebView w=new WebView(this);view[0]=w;w.getSettings().setJavaScriptEnabled(true);w.getSettings().setAllowFileAccess(false);w.getSettings().setAllowContentAccess(false);w.addJavascriptInterface(new Bridge(),"MediaFlowNative");
                w.setWebViewClient(new WebViewClient(){
                    @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request){return true;}
                    @Override public WebResourceResponse shouldInterceptRequest(WebView web,WebResourceRequest request){
                        String value=request.getUrl().toString();
                        if(!value.startsWith(ORIGIN))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                        String name=value.substring(ORIGIN.length());
                        if(!name.matches("[A-Za-z0-9._-]+\\.(?:js|html)"))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                        try{return new WebResourceResponse(name.endsWith(".js")?"text/javascript":"text/html","UTF-8",getAssets().open(name));}catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
                    }
                });
                w.loadUrl(ORIGIN+"resolver.html");
            }catch(Exception e){problem[0]=safeError(e);ready.countDown();}
        });
        try{
            if(!ready.await(30,TimeUnit.SECONDS) || problem[0]!=null)throw new IOException(problem[0]!=null?problem[0]:"The video resolver could not start.");
            main.post(()->view[0].evaluateJavascript("window.resolveSharedLink("+JSONObject.quote(url)+")",null));
            if(!complete.await(180,TimeUnit.SECONDS))throw new IOException("The video source timed out. Try again.");
            JSONObject parsed=new JSONObject(result[0]);if(!parsed.optBoolean("ok"))throw new IOException(parsed.optString("error","No supported video was found."));return parsed.getJSONObject("media");
        }finally{main.post(()->{if(view[0]!=null)view[0].destroy();});}
    }
    private void download(String url) throws Exception {
        status("Finding video sources…","");JSONObject media=resolve(url),headers=media.optJSONObject("headers");String format=media.getString("format");
        boolean hls="m3u8".equals(format);String ext=hls?media.optString("outputExtension","ts"):format;
        if(!("mp4".equals(ext)||"webm".equals(ext)||"ts".equals(ext)))throw new IOException("This video format is not supported.");
        String title=media.optString("title","Video").replaceAll("[\\x00-\\x1f<>:\"/\\\\|?*]"," ").replaceAll("\\s+"," ").trim();
        if(title.isEmpty())title="Video";if(title.length()>100)title=title.substring(0,100).trim();
        String file=title+"."+ext,mime="webm".equals(ext)?"video/webm":"ts".equals(ext)?"video/mp2t":"video/mp4";
        ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,file);values.put(MediaStore.Downloads.MIME_TYPE,mime);values.put(MediaStore.Downloads.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/MediaFlow");values.put(MediaStore.Downloads.IS_PENDING,1);
        Uri destination=getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);if(destination==null)throw new IOException("Could not create the download file.");
        boolean success=false;
        try { try(OutputStream output=getContentResolver().openOutputStream(destination,"w")){
            if(output==null)throw new IOException("Could not open the download file.");
            if(hls){JSONArray units=media.getJSONArray("units");Map<String,byte[]> keys=new HashMap<>();for(int i=0;i<units.length();i++){
                JSONObject unit=units.getJSONObject(i);status("Downloading segment "+(i+1)+" of "+units.length()+"…","");
                JSONObject key=unit.optJSONObject("key"),range=unit.optJSONObject("range");HttpURLConnection c=connection(unit.getString("url"),headers,range);
                try(InputStream raw=c.getInputStream()){
                    InputStream input=raw;
                    if(key!=null){String keyUrl=key.getString("url");byte[] keyBytes=keys.get(keyUrl);if(keyBytes==null){HttpURLConnection kc=connection(keyUrl,headers,null);try{keyBytes=readLimited(kc.getInputStream(),64);}finally{kc.disconnect();}if(keyBytes.length!=16)throw new IOException("Invalid HLS encryption key.");keys.put(keyUrl,keyBytes);}
                        Cipher cipher=Cipher.getInstance("AES/CBC/PKCS5Padding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(keyBytes,"AES"),new IvParameterSpec(iv(key.optString("iv",""),unit.optLong("sequence"))));input=new CipherInputStream(raw,cipher);}
                    long count=copyVideo(input,output,false);if(range!=null && key==null && count!=range.getLong("length"))throw new IOException("Incomplete video segment.");
                }finally{c.disconnect();}
            }}else{
                HttpURLConnection c=connection(media.getString("url"),headers,null);try(InputStream input=c.getInputStream()){long bytes=copyVideo(input,output,true);long expected=c.getContentLengthLong();if(expected>0 && c.getContentEncoding()==null && bytes!=expected)throw new IOException("The video ended before all data arrived.");}finally{c.disconnect();}
            }
            output.flush();
        } success=true; }finally{if(!success)getContentResolver().delete(destination,null,null);}
        try{ContentValues finished=new ContentValues();finished.put(MediaStore.Downloads.IS_PENDING,0);if(getContentResolver().update(destination,finished,null,null)!=1)throw new IOException("Could not finish saving the video.");}
        catch(Exception e){getContentResolver().delete(destination,null,null);throw e;}
        status("Saved "+file+" in Downloads / MediaFlow.",destination.toString());
    }
    private long copyVideo(InputStream input,OutputStream output,boolean progress) throws IOException {
        PushbackInputStream stream=new PushbackInputStream(new BufferedInputStream(input),512);byte[] first=new byte[512];int n=stream.read(first);if(n<0)throw new IOException("The server returned an empty video.");
        String text=new String(first,0,n,StandardCharsets.UTF_8).stripLeading();if(text.matches("(?is)^<(?:!doctype\\s+html|html|head|body|script|\\?xml)\\b.*") || text.matches("(?s)^[{\\[].*\\\"(?:error|message|status|code)\\\"\\s*:.*"))throw new IOException("The site returned an access or verification page. Open the source in your browser and try again.");
        stream.unread(first,0,n);long total=0;byte[] buffer=new byte[64*1024];while((n=stream.read(buffer))!=-1){if(Thread.currentThread().isInterrupted())throw new IOException("Download interrupted.");output.write(buffer,0,n);total+=n;if(progress && System.currentTimeMillis()-lastProgress>1000){lastProgress=System.currentTimeMillis();status("Downloading… "+(total/(1024*1024))+" MB","");}}
        return total;
    }
    private byte[] iv(String hex,long sequence) throws IOException {
        try{BigInteger value=hex.isEmpty()?BigInteger.valueOf(sequence):new BigInteger(hex.replaceFirst("(?i)^0x",""),16);byte[] raw=value.toByteArray(),result=new byte[16];if(value.signum()<0 || raw.length>17 || raw.length==17 && raw[0]!=0)throw new IOException("Invalid HLS encryption IV.");int count=Math.min(16,raw.length);System.arraycopy(raw,raw.length-count,result,16-count,count);return result;}catch(NumberFormatException e){throw new IOException("Invalid HLS encryption IV.");}
    }
}
