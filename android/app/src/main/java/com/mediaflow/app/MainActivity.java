package com.mediaflow.app;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class MainActivity extends Activity {
    private static final Pattern LINK=Pattern.compile("https?://[^\\s<>\\\"']+",Pattern.CASE_INSENSITIVE);
    private EditText link;
    private TextView status;
    private Button open;
    private String savedUri="";
    private final BroadcastReceiver receiver=new BroadcastReceiver(){
        @Override public void onReceive(Context context,Intent intent){showStatus(intent.getStringExtra("status"),intent.getStringExtra("uri"));}
    };

    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(dp(24),dp(36),dp(24),dp(24));
        layout.setBackgroundColor(0xfff2f2f7);
        TextView title=new TextView(this);title.setText("MediaFlow");title.setTextSize(30);title.setTextColor(0xff1c1c1e);title.setTypeface(null,1);layout.addView(title);
        TextView description=new TextView(this);description.setText("Share a video link to MediaFlow, or paste one below.");description.setTextSize(15);description.setTextColor(0xff505058);description.setPadding(0,dp(8),0,dp(22));layout.addView(description);
        link=new EditText(this);link.setSingleLine(true);link.setHint("https://…");link.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);layout.addView(link,new LinearLayout.LayoutParams(-1,dp(54)));
        Button download=new Button(this);download.setText("Download link");download.setAllCaps(false);download.setOnClickListener(v->startDownload(link.getText().toString()));layout.addView(download,new LinearLayout.LayoutParams(-1,dp(52)));
        TextView heading=new TextView(this);heading.setText("Download status");heading.setTextSize(18);heading.setTypeface(null,1);heading.setPadding(0,dp(24),0,dp(8));layout.addView(heading);
        status=new TextView(this);status.setTextSize(14);status.setTextColor(0xff505058);status.setTextIsSelectable(true);layout.addView(status);
        open=new Button(this);open.setText("Open downloaded video");open.setAllCaps(false);open.setVisibility(Button.GONE);open.setOnClickListener(v->openVideo());layout.addView(open);
        TextView note=new TextView(this);note.setText("Downloads are saved in Downloads / MediaFlow. Some sites require a session, verification, or unsupported protected streams.");note.setTextColor(0xff65656e);note.setTextSize(13);note.setPadding(0,dp(24),0,0);layout.addView(note);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(layout);setContentView(scroll);
        var prefs=getSharedPreferences("downloads",MODE_PRIVATE);showStatus(prefs.getString("status","Ready to receive a link."),prefs.getString("uri",""));
        if(state==null)handleIntent(getIntent());
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},1);
    }
    @Override protected void onStart(){super.onStart();IntentFilter filter=new IntentFilter(DownloadService.STATUS_ACTION);if(Build.VERSION.SDK_INT>=33)registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(receiver,filter);var p=getSharedPreferences("downloads",MODE_PRIVATE);showStatus(p.getString("status","Ready to receive a link."),p.getString("uri",""));}
    @Override protected void onStop(){unregisterReceiver(receiver);super.onStop();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleIntent(intent);}
    private void handleIntent(Intent intent){
        if(Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())){
            String shared=intent.getStringExtra(Intent.EXTRA_TEXT),url=firstLink(shared);
            if(url.isEmpty()){showStatus("The shared text does not contain an HTTP or HTTPS link.","");return;}
            link.setText(url);startDownload(url);
        }
    }
    private String firstLink(String text){Matcher m=LINK.matcher(text==null?"":text);return m.find()?m.group().replaceAll("[.,;!?]+$",""):"";}
    private void startDownload(String input){
        String value=firstLink(input);
        if(value.isEmpty()){showStatus("Paste a valid HTTP or HTTPS video link.","");return;}
        link.setText(value);Intent service=new Intent(this,DownloadService.class).putExtra("url",value);
        try{startForegroundService(service);showStatus("Added to downloads.","");}catch(Exception e){showStatus("Could not start download: "+e.getMessage(),"");}
    }
    private void showStatus(String text,String uri){if(status==null)return;status.setText(text==null?"":text);savedUri=uri==null?"":uri;open.setVisibility(savedUri.isEmpty()?Button.GONE:Button.VISIBLE);}
    private void openVideo(){try{Intent view=new Intent(Intent.ACTION_VIEW);view.setDataAndType(Uri.parse(savedUri),"video/*");view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(view);}catch(Exception e){showStatus("Saved to Downloads / MediaFlow. Open it with a video player.",savedUri);}}
    private int dp(int value){return Math.round(getResources().getDisplayMetrics().density*value);}
}
