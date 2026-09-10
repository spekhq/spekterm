## ADDED Requirements

### Requirement: view 的選擇為全域，且跨重啟保留

當前 view 的選擇 SHALL 為**單一的全域偏好**，SHALL NOT 屬於個別 session。
於任何一個 agent session 切換 view，**所有 agent session** SHALL 一起改變。

**作用域是「所有 agent session」而不是「所有 session」** —— shell 目標的 session 仍然
不具備對話 view（見「agent session 有兩種可切換的 view，終端為預設」），該判定不受本條影響。

**切換的入口 SHALL 留在個別 session 上** —— 改變的只有作用域，不是操作的位置。

該選擇 SHALL 跨應用程式重啟保留，且 SHALL 與其他使用者偏好落盤於同一處；
**SHALL NOT 落盤於 session 的持久化紀錄**。兩處都寫的實作使「兩個 session 的 view 不一樣」
重新變得表達得出來，因此驗收 SHALL 同時斷言它**不在** session 的持久化紀錄裡。

**未設定時 SHALL 視為終端 view。**

持久化的值 SHALL 以白名單判定：**恰為已定義的兩種 view 之一才採用**，其餘一律視為未設定。
把不合法的值直接當成終端，會使「檔案損壞」與「使用者選了終端」無法區分。

#### Scenario: 切換一個 session 的 view，其他 session 一起改變

- **WHEN** 使用者於一個 agent session 切換到對話 view，且另有其他 agent session 存在
- **THEN** 其他 agent session 亦呈現對話 view

#### Scenario: 切回終端時其他 session 亦回到終端

- **WHEN** 使用者於一個 agent session 自對話 view 切回終端 view，且另有其他 agent session 存在
- **THEN** 其他 agent session 亦呈現終端 view

**兩個方向都要**：全部已在對話 view 時，「切換其中一個之後另一個是對話 view」與
「它一直都是對話 view」在觀察上完全相同。往終端方向的那一次才具鑑別力。

#### Scenario: 選擇不落在 session 的持久化紀錄裡

- **WHEN** 使用者切換 view 之後，檢視 session 的持久化紀錄
- **THEN** 該紀錄 SHALL NOT 含有任何逐 session 的 view 欄位

#### Scenario: 重啟後回到上次的選擇

- **WHEN** 使用者切換到對話 view，關閉並重新開啟應用程式，再喚醒一個 agent session
- **THEN** 該 session 以對話 view 呈現

#### Scenario: 持久化的值不合法時回到終端

- **WHEN** 持久化的偏好中，view 的值不是已定義的兩種之一
- **THEN** 呈現終端 view

## MODIFIED Requirements

### Requirement: agent session 有兩種可切換的 view，終端為預設

agent 目標的 session SHALL 具備**終端**與**對話**兩種 view，並 SHALL 提供在兩者之間切換的入口。

**終端 view SHALL 為預設**，且 SHALL NOT 可被移除 —— 它是對話 view 無法處理任何情況時的逃生口。
「預設」指的是**尚未選擇過時的值**；使用者選擇之後，新建的 session SHALL 採用當下的選擇
（見「view 的選擇為全域，且跨重啟保留」）。

**逃生口的作用域亦為全域** —— 切換 SHALL 使全部回到終端 view。**這是全域化刻意接受的代價**，
而它比「對話 view 壞掉時」廣：`agent-input-bridge` 要求等待狀態未知、等待選擇、以及送出後
未確認時，皆指引使用者切換到終端 view，而那些是 per-session 事件。

**SHALL NOT 以「該 session 自動退回終端」化解。** 兩個理由：其一，一個 session 的 view 與其他
不同、且是被系統寫上去的，在資料上就是一個 per-session 覆寫，只是寫入者換人 —— 它承受與
使用者覆寫相同的批評，而且更隱形。其二，`agent-transcript-stream` 明文要求內容無法取得時
**必須於該 session 的呈現中被說明，SHALL NOT 靜默地呈現為「沒有內容」**；自動退回會把那份
說明變成一次無聲的 view 切換，使用者只會看到「它有時候自己跳回終端」。**逃生口是使用者按的，
不是系統替他按的。**

shell 目標的 session SHALL NOT 具備對話 view，亦 SHALL NOT 呈現切換入口 —— 它沒有 agent 紀錄。

#### Scenario: 新建的 agent session 預設為終端 view

- **WHEN** 使用者尚未切換過 view，並建立一個 agent 目標的 session
- **THEN** 該 session 呈現終端 view
- **AND** 提供切換到對話 view 的入口

#### Scenario: 已選擇對話 view 時，新建的 session 採用該選擇

- **WHEN** 使用者已切換到對話 view，並建立一個 agent 目標的 session
- **THEN** 該 session 呈現對話 view

#### Scenario: 切換到對話 view 再切回

- **WHEN** 使用者於一個 agent session 切換到對話 view，再切回終端 view
- **THEN** 終端 view 呈現其原有內容

#### Scenario: shell session 沒有對話 view

- **WHEN** 使用者檢視一個 shell 目標的 session
- **THEN** 不呈現切換到對話 view 的入口

## REMOVED Requirements

### Requirement: view 的選擇為 per-session，且跨重啟保留

**Reason**：條文寫著「SHALL NOT 為全域設定 —— 使用者完全可能一邊以對話 view 看 agent、
一邊以終端 view 用 shell」，**而那個理由不成立**：shell 目標的 session 根本不具備對話 view
（同一份 spec 的另一條 requirement 就這麼寫，而保障它的是 spawn 目標的判定，不是逐 session
的儲存）。它實際約束的只有「兩個 agent session 各自不同」，而 dogfood 認定那不是使用者要的。

**第二個、更硬的理由**：`session-persistence` 要求 session 的持久化內容 SHALL 限於重建所必需
的事實，並逐項列舉 —— view 從來不在那張清單上。本條當初把它寫進 session 的持久化紀錄時，
就已經與那條有張力。

**Migration**：由「view 的選擇為全域，且跨重啟保留」取代。既有 session 持久化紀錄中的
逐 session view 欄位於讀取時忽略；升級後第一次啟動，先前切到對話 view 的 session 回到終端，
使用者切換一次即恢復。不提供遷移程序 —— 一次性、看得見，且成本低於一段只會執行一次的程式碼。
